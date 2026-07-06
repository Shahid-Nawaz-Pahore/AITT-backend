// src/services/company.service.js
const Company = require('../models/Company');
const User = require('../models/User');
const Certificate = require('../models/Certificate');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { getAdapter } = require('./sorobanAdapter');
const indexer = require('./indexer.service');
const { generateCustodialWallet } = require('../utils/wallet');
const { hashPassword } = require('../utils/crypto');
const { toCompany, paginate } = require('../utils/serializers');
const { fundIfEnabled } = require('./funding.service');

/**
 * Create a company. If session provided, this will be created inside that session.
 * @param {Object} companyData
 * @param {Object} options - { session }
 */
async function createCompany(companyData, options = {}) {
  try {
    if (!companyData || !companyData.name) {
      throw new AppError(400, 'Company name is required');
    }

    if (options.session) {
      // create as array to use session
      const [doc] = await Company.create([companyData], { session: options.session });
      logger.info('Company created (session)', { companyId: doc._id, name: doc.name });
      return doc;
    }

    const doc = await Company.create(companyData);
    logger.info('Company created', { companyId: doc._id, name: doc.name });
    return doc;
  } catch (err) {
    logger.error('createCompany failed', { err: err.message });
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'Failed to create company', err.message);
  }
}

async function getCompanyById(id) {
  const doc = await Company.findById(id);
  if (!doc) throw new AppError(404, 'Company not found');
  return doc;
}

/** getCompanySerialized — single company in the frontend shape (with doc count). */
async function getCompanySerialized(id) {
  const doc = await Company.findById(id);
  if (!doc) throw new AppError(404, 'Company not found');
  const docCount = await Certificate.countDocuments({ companyId: doc._id });
  return toCompany(doc, docCount);
}

async function listCompaniesWithUsers() {
  try {
    const companies = await Company.aggregate([
      // (Optional) add filtering here if you want to exclude soft-deleted companies or similar
      { $sort: { createdAt: -1 } },

      // Lookup users that reference this company._id in their companyId
      {
        $lookup: {
          from: 'users', // collection name
          let: { companyId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$companyId', '$$companyId'] } } },
            {
              $project: {
                _id: 1,
                email: 1,
                role: 1,
                isActive: 1,
                walletAddress: 1,
                lastLoginAt: 1,
                createdAt: 1
              }
            },
            { $sort: { createdAt: -1 } } // newest users first (optional)
          ],
          as: 'users'
        }
      },

      // Project only important company fields + the users array
      {
        $project: {
          _id: 1,
          name: 1,
          contactEmail: 1,
          contactPhone: 1,
          walletAddress: 1,
          metadata: 1,
          createdAt: 1,
          updatedAt: 1,
          users: 1
        }
      }
    ]).allowDiskUse(true);

    logger.info('listCompaniesWithUsers: fetched companies with users', { companiesCount: companies.length });
    return companies;
  } catch (err) {
    logger.error('listCompaniesWithUsers failed', { err: err.message });
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'Failed to list companies with users', err.message);
  }
}

async function listCompanies({ skip = 0, limit = 50, q = '' } = {}) {
  const filter = {};
  if (q) filter.$text = { $search: q };
  const docs = await Company.find(filter).skip(parseInt(skip, 10)).limit(Math.min(100, limit));
  return docs;
}

/**
 * registerCompany — public self-registration (frontend addCompany).
 * Creates a PENDING company + a custodial wallet + a company_admin login.
 * No multi-doc transaction (works on standalone Mongo); best-effort rollback of
 * the company if the user create fails.
 */
async function registerCompany({ name, email, password = null, contactPhone = null, wallet = null }) {
  if (!name || !email) throw new AppError(400, 'name and email are required');

  if (await User.findOne({ email: String(email).toLowerCase() })) {
    throw new AppError(409, 'A user with this email already exists');
  }

  // One custodial key per company (used as the store_document actor).
  const custodial = wallet ? { publicKey: wallet, secretEnc: null } : generateCustodialWallet();

  const company = await Company.create({
    name,
    contactEmail: email,
    contactPhone,
    walletAddress: custodial.publicKey,
    walletSecretEnc: custodial.secretEnc,
    status: 'pending',
  });

  try {
    const passwordHash = password ? await hashPassword(password) : null;
    await User.create({
      email: String(email).toLowerCase(),
      passwordHash,
      role: 'company_admin',
      companyId: company._id,
      walletAddress: custodial.publicKey,
    });
  } catch (err) {
    await Company.findByIdAndDelete(company._id).catch(() => {});
    throw err instanceof AppError ? err : new AppError(500, 'Failed to create company admin', err.message);
  }

  logger.info('Company registered (pending)', { companyId: company._id, name });
  return toCompany(company, 0);
}

/**
 * approveCompany — admin approves a pending company -> whitelist_address on
 * chain -> mirror to 'active'. Idempotent if already active.
 */
async function approveCompany(id, { approverUserId = null, adapter = getAdapter() } = {}) {
  const company = await Company.findById(id).select('+walletSecretEnc');
  if (!company) throw new AppError(404, 'Company not found');
  if (company.status === 'active') return toCompany(company);
  if (!company.walletAddress) throw new AppError(409, 'Company has no wallet to whitelist');

  // B5: fund the custodial wallet (testnet) so it can later sign store_document.
  // Best-effort, real-mode only; never blocks approval.
  await fundIfEnabled(company.walletAddress);

  const { mirrored } = await indexer.writeThrough({
    adapter,
    method: 'whitelistAddress',
    args: [company.walletAddress, {}],
    purpose: 'whitelist',
    meta: { submittedByUserId: approverUserId },
    mirror: { op: 'mirrorCompanyApproved', payload: { companyId: company._id } },
  });

  logger.info('Company approved + whitelisted', { companyId: company._id });
  const docCount = await Certificate.countDocuments({ companyId: company._id });
  return toCompany(mirrored, docCount);
}

/** removeCompany — delete the company and its admin users (frontend removeCompany). */
async function removeCompany(id) {
  const company = await Company.findById(id);
  if (!company) throw new AppError(404, 'Company not found');
  await User.deleteMany({ companyId: company._id });
  await Company.findByIdAndDelete(company._id);
  logger.info('Company removed', { companyId: id });
  return { deleted: true };
}

/** listCompaniesSerialized — frontend-shaped, paginated, with document counts. */
async function listCompaniesSerialized({ page = 1, limit = 20, q = '' } = {}) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const filter = q ? { $text: { $search: q } } : {};

  const [companies, total] = await Promise.all([
    Company.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Company.countDocuments(filter),
  ]);

  // Document counts per company in one aggregate.
  const ids = companies.map((c) => c._id);
  const counts = await Certificate.aggregate([
    { $match: { companyId: { $in: ids } } },
    { $group: { _id: '$companyId', n: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));

  const items = companies.map((c) => toCompany(c, countMap[String(c._id)] || 0));
  return paginate(items, { page, limit, total });
}

module.exports = {
  createCompany,
  getCompanyById,
  getCompanySerialized,
  listCompanies,
  listCompaniesWithUsers,
  registerCompany,
  approveCompany,
  removeCompany,
  listCompaniesSerialized,
};
