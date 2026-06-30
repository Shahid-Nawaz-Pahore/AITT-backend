// src/services/proposal.service.js
// ---------------------------------------------------------------------------
// Multi-sig governance proposals (P4).
//
//   on-chain (create_proposal / approve_proposal, auto-executes at threshold):
//     revocation       -> RevokeCertificate(docHash)
//     governance_rule  -> UpdateThreshold(n)
//     contract_upgrade -> ContractUpgrade(wasmHash)
//   OFF-CHAIN (DB only — gap #1, the contract has NO FrameworkUpdate action):
//     framework_update -> collect approvals in the DB; when signers >= threshold,
//                         apply the framework change + mark executed. NO chain call.
//
// Gap #5: title/description/proposer/createdAt live in the DB; `signers` for
// on-chain proposals are read back from the contract's approvals[]; status =
// executed ? 'executed' : 'pending' (or backend-only 'rejected').
//
// IMPORTANT (deployed-contract behavior surfaced in the API): create_proposal
// starts with 0 approvals — creating a proposal is NOT signing it. The proposer
// (if a sub-admin) must also call sign to approve.
// ---------------------------------------------------------------------------
const Proposal = require('../models/Proposal');
const Certificate = require('../models/Certificate');
const Framework = require('../models/Framework');
const GovernanceConfig = require('../models/GovernanceConfig');
const SubAdmin = require('../models/SubAdmin');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { getAdapter, mapProposalAction, isOnChainProposalType } = require('./sorobanAdapter');
const indexer = require('./indexer.service');
const { decryptSecret } = require('../utils/wallet');
const { toProposal, paginate } = require('../utils/serializers');
const { isAdmin, isSubAdmin } = require('../utils/roles');

const ONCHAIN_PURPOSE = { revocation: 'create_proposal', governance_rule: 'create_proposal', contract_upgrade: 'create_proposal' };

// Resolve the proposer's on-chain identity. Main admin (super_admin) signs with
// the service key; a sub-admin signs with their custodial key.
async function resolveProposer(userId, adapter) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(401, 'Proposer account not found');
  if (isAdmin(user.role)) {
    const mainAdmin = await adapter.mainAdminAddress();
    return { wallet: mainAdmin, secret: null, name: 'Main Admin', userId };
  }
  if (isSubAdmin(user.role)) {
    const sa = await SubAdmin.findById(user.subAdminId).select('+walletSecretEnc');
    if (!sa || sa.status !== 'active') throw new AppError(409, 'Proposer sub-admin is not activated on-chain');
    return { wallet: sa.walletAddress, secret: decryptSecret(sa.walletSecretEnc), name: sa.name, userId };
  }
  throw new AppError(403, 'Only the main admin or a sub-admin can create proposals');
}

// Signing/approving is sub-admin only (mirrors approve_proposal on the contract).
async function resolveSigner(userId) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(401, 'Signer account not found');
  let sa = null;
  if (user.subAdminId) sa = await SubAdmin.findById(user.subAdminId).select('+walletSecretEnc');
  if (!sa && user.walletAddress) sa = await SubAdmin.findOne({ walletAddress: user.walletAddress }).select('+walletSecretEnc');
  if (!sa) throw new AppError(403, 'Only sub-admins can sign proposals');
  if (sa.status !== 'active') throw new AppError(409, 'Sub-admin is not activated on-chain');
  return { wallet: sa.walletAddress, secret: decryptSecret(sa.walletSecretEnc), name: sa.name, id: sa._id };
}

// Build the normalized on-chain action + the payload we persist for sign-time mirroring.
async function buildOnChainAction(type, { targetRef, payload = {} }) {
  if (type === 'revocation') {
    // targetRef is a document id; resolve to its content hash.
    const cert = targetRef && /^[a-f0-9]{64}$/i.test(targetRef)
      ? await Certificate.findOne({ metadataHash: targetRef })
      : await Certificate.findById(targetRef).catch(() => null);
    if (!cert) throw new AppError(404, 'Target document for revocation not found');
    const resolved = { docHash: cert.metadataHash };
    return { action: mapProposalAction('revocation', resolved), payload: resolved, targetRef: String(cert._id) };
  }
  if (type === 'governance_rule') {
    const value = Number(payload.value ?? payload.threshold);
    if (!Number.isInteger(value) || value < 1) throw new AppError(400, 'governance_rule requires payload.value (integer >= 1)');
    return { action: mapProposalAction('governance_rule', { value }), payload: { value }, targetRef: targetRef || null };
  }
  if (type === 'contract_upgrade') {
    if (!payload.wasmHash) throw new AppError(400, 'contract_upgrade requires payload.wasmHash');
    return { action: mapProposalAction('contract_upgrade', { wasmHash: payload.wasmHash }), payload: { wasmHash: payload.wasmHash }, targetRef: targetRef || null };
  }
  throw new AppError(400, `Unknown on-chain proposal type: ${type}`);
}

function validateFrameworkPayload(payload = {}) {
  const action = payload.action;
  if (!['create', 'update', 'deactivate', 'activate'].includes(action)) {
    throw new AppError(400, "framework_update requires payload.action in [create, update, deactivate, activate]");
  }
  if (action === 'create' && !payload.name) throw new AppError(400, 'framework_update create requires payload.name');
  if (['update', 'deactivate', 'activate'].includes(action) && !payload.frameworkId) {
    throw new AppError(400, `framework_update ${action} requires payload.frameworkId`);
  }
  return payload;
}

/**
 * createProposal — on-chain for the 3 contract actions, OFF-CHAIN for
 * framework_update. Returns the proposal + a note that it has 0 approvals.
 */
async function createProposal({ type, title, description = '', targetRef = null, payload = {}, creatorUserId, adapter = getAdapter() }) {
  if (!Proposal.PROPOSAL_TYPES.includes(type)) throw new AppError(400, `Unknown proposal type: ${type}`);
  if (!title) throw new AppError(400, 'title is required');

  const proposer = await resolveProposer(creatorUserId, adapter);
  const cfg = await GovernanceConfig.getSingleton();
  const threshold = cfg.required;

  const base = {
    type, title, description,
    status: 'pending', threshold, signers: [],
    createdBy: proposer.name, createdById: proposer.userId, proposerWallet: proposer.wallet,
    executed: false,
  };

  // OFF-CHAIN: framework_update (gap #1) — no chain call.
  if (type === 'framework_update') {
    const fwPayload = validateFrameworkPayload(payload);
    const proposal = await Proposal.create({ ...base, onChain: false, targetRef: fwPayload.frameworkId || targetRef || null, payload: fwPayload });
    logger.info('Framework-update proposal created (off-chain)', { id: proposal._id });
    return { proposal: toProposal(proposal), note: 'framework_update is governed off-chain; collect approvals via sign. Created with 0 approvals.' };
  }

  // ON-CHAIN: revocation / governance_rule / contract_upgrade.
  const built = await buildOnChainAction(type, { targetRef, payload });
  const receipt = await adapter.createProposal(proposer.wallet, built.action, { signerSecret: proposer.secret });
  await indexer.recordTx({ purpose: ONCHAIN_PURPOSE[type], receipt, method: 'createProposal', submittedByUserId: creatorUserId });

  const proposal = await Proposal.create({
    ...base, onChain: true, onChainId: receipt.proposalId ?? null,
    targetRef: built.targetRef, payload: built.payload, txHashCreate: receipt.hash,
  });

  logger.info('On-chain proposal created (0 approvals)', { id: proposal._id, onChainId: proposal.onChainId, type });
  return {
    proposal: toProposal(proposal),
    note: 'Created on-chain with 0 approvals — creating is not signing. The proposer (if a sub-admin) must also sign to approve.',
  };
}

// Apply an executed framework_update to the Framework collection (off-chain effect).
async function applyFrameworkUpdate(payload) {
  switch (payload.action) {
    case 'create':
      return Framework.create({ name: payload.name, description: payload.description || '' });
    case 'update':
      return Framework.findByIdAndUpdate(payload.frameworkId, { name: payload.name, description: payload.description }, { new: true });
    case 'deactivate':
      return Framework.findByIdAndUpdate(payload.frameworkId, { active: false }, { new: true });
    case 'activate':
      return Framework.findByIdAndUpdate(payload.frameworkId, { active: true }, { new: true });
    default:
      throw new AppError(400, `Unknown framework_update action: ${payload.action}`);
  }
}

/**
 * signProposal — approve a proposal. On-chain: approve_proposal (auto-executes
 * at threshold); we read back the contract's approvals[] as `signers` (gap #5)
 * and mirror any side-effect. Off-chain (framework_update): tally in the DB and
 * apply when signers >= threshold.
 */
async function signProposal({ id, signerUserId, adapter = getAdapter() }) {
  const proposal = await Proposal.findById(id);
  if (!proposal) throw new AppError(404, 'Proposal not found');
  if (proposal.status !== 'pending') throw new AppError(409, `Proposal is already ${proposal.status}`);

  const signer = await resolveSigner(signerUserId);
  if (proposal.signers.includes(signer.wallet)) throw new AppError(409, 'You have already signed this proposal');

  if (!proposal.onChain) {
    // OFF-CHAIN framework_update tally.
    proposal.signers.push(signer.wallet);
    if (proposal.signers.length >= proposal.threshold) {
      await applyFrameworkUpdate(proposal.payload);
      proposal.executed = true;
      proposal.executedAt = new Date();
      proposal.status = 'executed';
      logger.info('Framework-update proposal executed (off-chain)', { id: proposal._id });
    }
    await proposal.save();
    return toProposal(proposal);
  }

  // ON-CHAIN approve.
  const receipt = await adapter.approveProposal(signer.wallet, proposal.onChainId, { signerSecret: signer.secret });
  await indexer.recordTx({ purpose: 'approve_proposal', receipt, method: 'approveProposal', proposalId: proposal._id, submittedByUserId: signerUserId });

  // gap #5: read the on-chain approvals (signer list) + executed flag back.
  const chainProp = await adapter.readProposal(proposal.onChainId);
  proposal.signers = (chainProp && chainProp.approvals) || [...proposal.signers, signer.wallet];
  proposal.executed = !!(chainProp && chainProp.executed);
  proposal.status = proposal.executed ? 'executed' : 'pending';
  if (proposal.executed) { proposal.executedAt = new Date(); proposal.txHashExecute = receipt.hash; }

  // Mirror the executed effect onto our DB.
  if (proposal.executed) {
    if (proposal.type === 'revocation') {
      await indexer.mirrorRevocation({ metadataHash: proposal.payload.docHash, receipt }).catch((e) => logger.warn('revoke mirror failed', { error: e.message }));
    } else if (proposal.type === 'governance_rule') {
      const cfg = await GovernanceConfig.getSingleton();
      cfg.required = await adapter.governanceThreshold();
      if (cfg.required > cfg.total) cfg.total = cfg.required;
      cfg.lastSyncedThreshold = cfg.required;
      await cfg.save();
    }
    // contract_upgrade: no DB side-effect.
  }

  await proposal.save();
  logger.info('Proposal signed', { id: proposal._id, signers: proposal.signers.length, executed: proposal.executed });
  return toProposal(proposal);
}

/** rejectProposal — backend-only state (the contract has no reject). Admin only. */
async function rejectProposal({ id, adminUserId = null }) {
  const proposal = await Proposal.findById(id);
  if (!proposal) throw new AppError(404, 'Proposal not found');
  if (proposal.status !== 'pending') throw new AppError(409, `Proposal is already ${proposal.status}`);
  proposal.status = 'rejected';
  await proposal.save();
  logger.info('Proposal rejected (backend-only)', { id: proposal._id, by: adminUserId });
  return toProposal(proposal);
}

async function listProposals({ page = 1, limit = 20, status = null, type = null } = {}) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  const [items, total] = await Promise.all([
    Proposal.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Proposal.countDocuments(filter),
  ]);
  return paginate(items.map(toProposal), { page, limit, total });
}

async function getProposal(id) {
  const proposal = await Proposal.findById(id);
  if (!proposal) throw new AppError(404, 'Proposal not found');
  return toProposal(proposal);
}

module.exports = {
  createProposal,
  signProposal,
  rejectProposal,
  listProposals,
  getProposal,
};
