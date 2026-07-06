// src/controllers/soroban.controller.js
// ---------------------------------------------------------------------------
// Raw chain ops/debug surface (/api/v1/soroban/*). ALL access goes through the
// sorobanAdapter (H3 #9 — the legacy soroban.service.js was retired). Writes are
// admin-gated (see soroban.routes) and signed with the service/main-admin key.
// Method names map to the DEPLOYED contract ABI (main_admin_address /
// transfer_main_admin), not the old v1 owner_* names.
// ---------------------------------------------------------------------------
const { getAdapter } = require('../services/sorobanAdapter');
const { generateWallet } = require('../utils/wallet');
const funding = require('../services/funding.service');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * POST /soroban/store_document  body: { name, hash }
 * Admin ops passthrough — anchors a raw document signed by the service key.
 */
async function storeDocument(req, res, next) {
  try {
    const { name, hash } = req.body;
    if (!name || !hash) {
      return res.status(400).json({ success: false, message: 'name and hash are required' });
    }
    const adapter = getAdapter();
    const actor = await adapter.mainAdminAddress();
    const receipt = await adapter.storeDocument(actor, name, hash, {});
    return res.json({ success: true, data: { tx: receipt } });
  } catch (err) {
    logger.error('soroban.storeDocument failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'storeDocument failed', err.message));
  }
}

/** GET /soroban/verify/:hash — public state-aware verification. */
async function verifyDocument(req, res, next) {
  try {
    const { hash } = req.params;
    if (!hash) return res.status(400).json({ success: false, message: 'hash required' });
    const value = await getAdapter().verifyDocument(hash);
    return res.json({ success: true, data: { document: value } });
  } catch (err) {
    logger.error('soroban.verifyDocument failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'verifyDocument failed', err.message));
  }
}

/** GET /soroban/read/:hash — public raw document read. */
async function readDocument(req, res, next) {
  try {
    const { hash } = req.params;
    if (!hash) return res.status(400).json({ success: false, message: 'hash required' });
    const doc = await getAdapter().readDocument(hash);
    return res.json({ success: true, data: { document: doc } });
  } catch (err) {
    logger.error('soroban.readDocument failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'readDocument failed', err.message));
  }
}

/** GET /soroban/is_whitelisted/:address — public. */
async function isWhitelisted(req, res, next) {
  try {
    const { address } = req.params;
    if (!address) return res.status(400).json({ success: false, message: 'address required' });
    const whitelisted = await getAdapter().isWhitelisted(address);
    return res.json({ success: true, data: { address, whitelisted: !!whitelisted } });
  } catch (err) {
    logger.error('soroban.isWhitelisted failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'isWhitelisted failed', err.message));
  }
}

/** POST /soroban/whitelist  body: { address } — admin. */
async function whitelistAddress(req, res, next) {
  try {
    const { address } = req.body;
    if (!address) return res.status(400).json({ success: false, message: 'address required' });
    const receipt = await getAdapter().whitelistAddress(address, {});
    return res.json({ success: true, data: { tx: receipt } });
  } catch (err) {
    logger.error('soroban.whitelistAddress failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'whitelistAddress failed', err.message));
  }
}

/** POST /soroban/remove_whitelist  body: { address } — admin. */
async function removeFromWhitelist(req, res, next) {
  try {
    const { address } = req.body;
    if (!address) return res.status(400).json({ success: false, message: 'address required' });
    const receipt = await getAdapter().removeFromWhitelist(address, {});
    return res.json({ success: true, data: { tx: receipt } });
  } catch (err) {
    logger.error('soroban.removeFromWhitelist failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'removeFromWhitelist failed', err.message));
  }
}

/** GET /soroban/owner — public. Main admin address (was owner_address). */
async function ownerAddress(req, res, next) {
  try {
    const owner = await getAdapter().mainAdminAddress();
    return res.json({ success: true, data: { owner } });
  } catch (err) {
    logger.error('soroban.ownerAddress failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'ownerAddress failed', err.message));
  }
}

/**
 * POST /soroban/transfer_ownership  body: { newOwner } — super_admin.
 * Maps to transfer_main_admin on the deployed contract. IRREVERSIBLE on the
 * shared contract; guarded to super_admin.
 */
async function transferOwnership(req, res, next) {
  try {
    const { newOwner } = req.body;
    if (!newOwner) return res.status(400).json({ success: false, message: 'newOwner required' });
    const receipt = await getAdapter().transferMainAdmin(newOwner, {});
    return res.json({ success: true, data: { tx: receipt } });
  } catch (err) {
    logger.error('soroban.transferOwnership failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'transferOwnership failed', err.message));
  }
}

/** POST /soroban/helpers/create_wallet — generate a fresh keypair (admin). */
async function createWallet(req, res, next) {
  try {
    const { publicKey, secret } = generateWallet();
    return res.json({ success: true, data: { wallet: { public_key: publicKey, secret } } });
  } catch (err) {
    logger.error('soroban.createWallet failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'createWallet failed', err.message));
  }
}

/** POST /soroban/helpers/fund_wallet  body: { publicKey } — testnet friendbot (admin). */
async function fundWallet(req, res, next) {
  try {
    const { publicKey } = req.body;
    if (!publicKey) return res.status(400).json({ success: false, message: 'publicKey required' });
    const result = await funding.fundWallet(publicKey);
    return res.json({ success: true, data: { result } });
  } catch (err) {
    logger.error('soroban.fundWallet failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'fundWallet failed', err.message));
  }
}

/** POST /soroban/init — super_admin. Initialize the contract main admin. */
async function initContract(req, res, next) {
  try {
    const receipt = await getAdapter().init({});
    return res.json({ success: true, data: { tx: receipt } });
  } catch (err) {
    logger.error('soroban.initContract failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'initContract failed', err.message));
  }
}

module.exports = {
  storeDocument,
  verifyDocument,
  readDocument,
  isWhitelisted,
  whitelistAddress,
  removeFromWhitelist,
  ownerAddress,
  transferOwnership,
  createWallet,
  fundWallet,
  initContract,
};
