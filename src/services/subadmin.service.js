// src/services/subadmin.service.js
// ---------------------------------------------------------------------------
// Sub-admin (reviewer / legal expert) management (P3). Mirrors the frontend's
// inviteSubAdmin / removeSubAdmin plus the on-chain add_sub_admin step needed
// before a sub-admin can submit reviews.
//
//   invite   -> DB profile (status 'invited') + custodial wallet + sub_admin login
//   activate -> add_sub_admin on chain -> status 'active' (can now review/approve)
//   remove   -> remove_sub_admin on chain (if active) + delete profile + login
// ---------------------------------------------------------------------------
const SubAdmin = require('../models/SubAdmin');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { getAdapter } = require('./sorobanAdapter');
const indexer = require('./indexer.service');
const { generateCustodialWallet } = require('../utils/wallet');
const { hashPassword } = require('../utils/crypto');
const { toSubAdmin, paginate } = require('../utils/serializers');

/** inviteSubAdmin — create the DB profile + custodial wallet + login. */
async function inviteSubAdmin({ name, email, password = null, wallet = null, invitedByUserId = null }) {
  if (!name || !email) throw new AppError(400, 'name and email are required');
  const lowerEmail = String(email).toLowerCase();

  if (await SubAdmin.findOne({ email: lowerEmail })) throw new AppError(409, 'A sub-admin with this email already exists');
  if (await User.findOne({ email: lowerEmail })) throw new AppError(409, 'A user with this email already exists');

  const custodial = wallet ? { publicKey: wallet, secretEnc: null } : generateCustodialWallet();

  const sa = await SubAdmin.create({
    name,
    email: lowerEmail,
    walletAddress: custodial.publicKey,
    walletSecretEnc: custodial.secretEnc,
    status: 'invited',
    invitedByUserId,
    reviewsDone: 0,
  });

  try {
    const passwordHash = password ? await hashPassword(password) : null;
    await User.create({
      email: lowerEmail,
      passwordHash,
      role: 'sub_admin',
      subAdminId: sa._id,
      walletAddress: custodial.publicKey,
    });
  } catch (err) {
    await SubAdmin.findByIdAndDelete(sa._id).catch(() => {});
    throw err instanceof AppError ? err : new AppError(500, 'Failed to create sub-admin login', err.message);
  }

  logger.info('Sub-admin invited', { subAdminId: sa._id, name });
  return toSubAdmin(sa);
}

/** activateSubAdmin — register on chain (add_sub_admin) -> status active. */
async function activateSubAdmin(id, { adminUserId = null, adapter = getAdapter() } = {}) {
  const sa = await SubAdmin.findById(id);
  if (!sa) throw new AppError(404, 'Sub-admin not found');
  if (sa.status === 'active') return toSubAdmin(sa);
  if (!sa.walletAddress) throw new AppError(409, 'Sub-admin has no wallet to register');

  const mainAdmin = await adapter.mainAdminAddress();
  const { mirrored } = await indexer.writeThrough({
    adapter,
    method: 'addSubAdmin',
    args: [mainAdmin, sa.walletAddress, {}],
    purpose: 'add_sub_admin',
    meta: { submittedByUserId: adminUserId },
    mirror: (receipt) => indexer.mirrorSubAdminActivated({ subAdminId: sa._id, receipt }),
  });

  logger.info('Sub-admin activated on chain', { subAdminId: sa._id });
  return toSubAdmin(mirrored);
}

/** listSubAdmins — frontend-shaped, paginated. */
async function listSubAdmins({ page = 1, limit = 20 } = {}) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const [subs, total] = await Promise.all([
    SubAdmin.find({}).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    SubAdmin.countDocuments({}),
  ]);
  return paginate(subs.map(toSubAdmin), { page, limit, total });
}

/** removeSubAdmin — remove on chain (if active) + delete profile + login. */
async function removeSubAdmin(id, { adminUserId = null, adapter = getAdapter() } = {}) {
  const sa = await SubAdmin.findById(id);
  if (!sa) throw new AppError(404, 'Sub-admin not found');

  if (sa.status === 'active' && sa.walletAddress) {
    try {
      const mainAdmin = await adapter.mainAdminAddress();
      const receipt = await adapter.removeSubAdmin(mainAdmin, sa.walletAddress, {});
      await indexer.recordTx({ purpose: 'remove_sub_admin', receipt, method: 'removeSubAdmin', submittedByUserId: adminUserId });
    } catch (err) {
      logger.warn('removeSubAdmin on-chain failed (continuing to delete profile)', { error: err.message });
    }
  }

  await User.deleteMany({ subAdminId: sa._id });
  await SubAdmin.findByIdAndDelete(sa._id);
  logger.info('Sub-admin removed', { subAdminId: id });
  return { deleted: true };
}

module.exports = {
  inviteSubAdmin,
  activateSubAdmin,
  listSubAdmins,
  removeSubAdmin,
};
