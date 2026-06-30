// src/services/governance.service.js
// ---------------------------------------------------------------------------
// Governance settings (P4). The N-of-M multi-sig config:
//   required (N) — mirrored on-chain as governance_threshold
//   total    (M) — number of eligible signers = ACTIVE sub-admins
//   signerWallets — the active sub-admins' wallets (frontend useGovernance)
//
// N must be <= M. Directly setting N here uses the contract's set_threshold
// (main-admin only); changing N via multi-sig is the governance_rule proposal
// path (see proposal.service.js -> UpdateThreshold).
// ---------------------------------------------------------------------------
const GovernanceConfig = require('../models/GovernanceConfig');
const SubAdmin = require('../models/SubAdmin');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { getAdapter } = require('./sorobanAdapter');
const indexer = require('./indexer.service');

// Active sub-admins are the eligible signers (M).
async function activeSigners() {
  const subs = await SubAdmin.find({ status: 'active' }).select('walletAddress');
  return subs.map((s) => s.walletAddress).filter(Boolean);
}

/**
 * getGovernance — current { required, total, signerWallets }. Keeps `total`
 * (M) in sync with the active-signer count and clamps required <= total.
 */
async function getGovernance() {
  const cfg = await GovernanceConfig.getSingleton();
  const signerWallets = await activeSigners();
  const total = Math.max(signerWallets.length, 1);

  let changed = false;
  if (cfg.total !== total) { cfg.total = total; changed = true; }
  if (cfg.required > total) { cfg.required = total; changed = true; }
  if (changed) await cfg.save();

  return { required: cfg.required, total, signerWallets };
}

/**
 * setGovernance — admin directly sets N (and optionally M). Enforces 1 <= N <= M,
 * then syncs the on-chain threshold via set_threshold.
 */
async function setGovernance({ required, total = null, adminUserId = null, adapter = getAdapter() }) {
  const cfg = await GovernanceConfig.getSingleton();
  const signers = await activeSigners();
  const effectiveTotal = Math.max(total != null ? Number(total) : cfg.total, signers.length, 1);

  const N = Number(required);
  if (!Number.isInteger(N) || N < 1) throw new AppError(400, 'required (N) must be an integer >= 1');
  if (N > effectiveTotal) throw new AppError(400, `required (N=${N}) cannot exceed total signers (M=${effectiveTotal})`);

  // Sync on-chain threshold (main-admin custodial).
  const mainAdmin = await adapter.mainAdminAddress();
  const receipt = await adapter.setThreshold(mainAdmin, N, {});
  await indexer.recordTx({ purpose: 'set_threshold', receipt, method: 'setThreshold', submittedByUserId: adminUserId });

  cfg.required = N;
  cfg.total = effectiveTotal;
  cfg.lastSyncedThreshold = N;
  cfg.txHashThreshold = receipt && receipt.hash;
  await cfg.save();

  logger.info('Governance threshold updated', { required: N, total: effectiveTotal });
  return getGovernance();
}

module.exports = { getGovernance, setGovernance, activeSigners };
