// src/controllers/soroban.controller.js
const sorobanService = require('../services/soroban.service');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * NOTE: Temporary change — this helper now always returns `null`,
 * which causes soroban.service to use the backend owner/service key.
 * We keep the function so request payloads with `useOwner` don't break,
 * but the flag is ignored for now.
 */
/**
 * Decide which secret key to use for signing
 * - useOwner=true → owner key (SERVICE_SECRET)
 * - useOwner=false → whitelisted key (WHITELIST_SECRET)
 */
function resolveSignerSecret(useOwner) {
  if (useOwner === true || useOwner === 'true') {
    return process.env.SERVICE_SECRET || null;
  }
  if (useOwner === false || useOwner === 'false') {
    return process.env.WHITELISTED_SIGNER_SECRET || null;
  }
  return null; // fallback (service defaults internally)
}


/**
 * POST /soroban/store_document
 * body: { name, hash, useOwner=true }
 */
async function storeDocument(req, res, next) {
  try {
    const { name, hash, useOwner } = req.body;
    if (!name || !hash) {
      return res.status(400).json({ success: false, message: 'name and hash are required' });
    }

    logger.info('soroban.storeDocument called', {
      namePrefix: (name || '').slice(0, 16),
      hashShort: (hash || '').slice(0, 16),
      note: 'useOwner flag ignored; signing with owner key'
    });

    // Always null for now (owner signing)
    const signerSecret = resolveSignerSecret(useOwner);

    const receipt = await sorobanService.storeDocument(name, hash, signerSecret);
    logger.info('soroban.storeDocument result', { namePrefix: (name || '').slice(0,16), txHash: receipt.hash });

    return res.json({ success: true, data: { tx: receipt } });
  } catch (err) {
    logger.error('soroban.storeDocument failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'storeDocument failed', err.message));
  }
}

/**
 * GET /soroban/verify/:hash?useOwner=true
 */
async function verifyDocument(req, res, next) {
  try {
    const hash = req.params.hash;
    const useOwner = req.query.useOwner;
    if (!hash) return res.status(400).json({ success: false, message: 'hash required' });

    logger.info('soroban.verifyDocument called', {
      hashShort: hash.slice(0, 16),
      note: 'useOwner flag ignored; using owner key for optional signer'
    });

    const signerSecret = resolveSignerSecret(useOwner);
    const value = await sorobanService.verifyDocument(hash, signerSecret);
    return res.json({ success: true, data: { document: value } });
  } catch (err) {
    logger.error('soroban.verifyDocument failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'verifyDocument failed', err.message));
  }
}

/**
 * GET /soroban/read/:hash?useOwner=true
 */
async function readDocument(req, res, next) {
  try {
    const hash = req.params.hash;
    const useOwner = req.query.useOwner;
    if (!hash) return res.status(400).json({ success: false, message: 'hash required' });

    logger.info('soroban.readDocument called', {
      hashShort: hash.slice(0, 16),
      note: 'useOwner flag ignored; using owner key for optional signer'
    });

    const signerSecret = resolveSignerSecret(useOwner);
    const doc = await sorobanService.readDocument(hash, signerSecret);
    return res.json({ success: true, data: { document: doc } });
  } catch (err) {
    logger.error('soroban.readDocument failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'readDocument failed', err.message));
  }
}

/**
 * GET /soroban/is_whitelisted/:address?useOwner=true
 */
async function isWhitelisted(req, res, next) {
  try {
    const address = req.params.address;
    const useOwner = req.query.useOwner;
    if (!address) return res.status(400).json({ success: false, message: 'address required' });

    logger.info('soroban.isWhitelisted called', {
      addrShort: address.slice(0, 8),
      note: 'useOwner flag ignored; using owner key for optional signer'
    });

    const signerSecret = resolveSignerSecret(useOwner);
    const whitelisted = await sorobanService.isWhitelisted(address, signerSecret);
    return res.json({ success: true, data: { address, whitelisted: !!whitelisted } });
  } catch (err) {
    logger.error('soroban.isWhitelisted failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'isWhitelisted failed', err.message));
  }
}

/**
 * POST /soroban/whitelist
 * body: { address, useOwner=true }
 */
async function whitelistAddress(req, res, next) {
  try {
    const { address, useOwner } = req.body;
    if (!address) return res.status(400).json({ success: false, message: 'address required' });

    logger.info('soroban.whitelistAddress called', { addrShort: address.slice(0, 8) });

    // still using owner key (protected endpoint anyway)
    const signerSecret = resolveSignerSecret(useOwner);
    const receipt = await sorobanService.whitelistAddress(address, signerSecret || null);
    return res.json({ success: true, data: { tx: receipt } });
  } catch (err) {
    logger.error('soroban.whitelistAddress failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'whitelistAddress failed', err.message));
  }
}

/**
 * POST /soroban/remove_whitelist
 * body: { address, useOwner=true }
 */
async function removeFromWhitelist(req, res, next) {
  try {
    const { address, useOwner } = req.body;
    if (!address) return res.status(400).json({ success: false, message: 'address required' });

    logger.info('soroban.removeFromWhitelist called', { addrShort: address.slice(0, 8) });

    const signerSecret = resolveSignerSecret(useOwner);
    const receipt = await sorobanService.removeFromWhitelist(address, signerSecret || null);
    return res.json({ success: true, data: { tx: receipt } });
  } catch (err) {
    logger.error('soroban.removeFromWhitelist failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'removeFromWhitelist failed', err.message));
  }
}

/**
 * GET /soroban/owner
 */
async function ownerAddress(req, res, next) {
  try {
    logger.info('soroban.ownerAddress called');
    const owner = await sorobanService.ownerAddress();
    return res.json({ success: true, data: { owner } });
  } catch (err) {
    logger.error('soroban.ownerAddress failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'ownerAddress failed', err.message));
  }
}

/**
 * POST /soroban/transfer_ownership
 * body: { newOwner, useOwner=true }
 */
async function transferOwnership(req, res, next) {
  try {
    const { newOwner, useOwner } = req.body;
    if (!newOwner) return res.status(400).json({ success: false, message: 'newOwner required' });

    logger.info('soroban.transferOwnership called', { newOwnerShort: newOwner.slice(0, 8) });

    const signerSecret = resolveSignerSecret(useOwner);
    const receipt = await sorobanService.transferOwnership(newOwner, signerSecret || null);
    return res.json({ success: true, data: { tx: receipt } });
  } catch (err) {
    logger.error('soroban.transferOwnership failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'transferOwnership failed', err.message));
  }
}

/**
 * POST /soroban/create_wallet
 */
async function createWallet(req, res, next) {
  try {
    logger.info('soroban.createWallet called');
    const wallet = sorobanService.createWallet();
    return res.json({ success: true, data: { wallet } });
  } catch (err) {
    logger.error('soroban.createWallet failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'createWallet failed', err.message));
  }
}

/**
 * POST /soroban/fund_wallet
 */
async function fundWallet(req, res, next) {
  try {
    const { publicKey } = req.body;
    if (!publicKey) return res.status(400).json({ success: false, message: 'publicKey required' });

    logger.info('soroban.fundWallet called', { publicShort: publicKey.slice(0, 8) });
    const result = await sorobanService.fundWallet(publicKey);
    return res.json({ success: true, data: { result } });
  } catch (err) {
    logger.error('soroban.fundWallet failed', { message: err.message });
    return next(err instanceof AppError ? err : new AppError(500, 'fundWallet failed', err.message));
  }
}

/**
 * POST /soroban/init
 * body: { useOwner=true }
 */
async function initContract(req, res, next) {
  try {
    const { useOwner } = req.body;
    logger.info('soroban.initContract called', { signerProvided: !!useOwner === false });

    const signerSecret = resolveSignerSecret(useOwner);
    const receipt = await sorobanService.initContract(signerSecret || null);
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
  initContract
};
