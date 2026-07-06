// src/routes/soroban.routes.js
const express = require('express');
const router = express.Router();
const sorobanController = require('../controllers/soroban.controller');
const { requireAuth, authenticateOptional } = require('../middlewares/auth.middleware');

/*
  AUTH RULES (P3 — locked down):
  - store_document is NO LONGER public. Documents are anchored via the
    review-gated /api/v1/documents flow (re-hashed server-side). This raw
    passthrough is now restricted to admins for ops/debugging only.
  - verify/read stay public (read-only verification).
  - init, transfer_ownership, whitelist, remove_whitelist remain admin-only.
*/

// Write operations
// LOCKED DOWN (was public): raw store_document is admin-only now.
router.post('/store_document', requireAuth(['super_admin', 'regulator_admin']), sorobanController.storeDocument);

// Public verification / read-only (no auth)
router.get('/verify/:hash', sorobanController.verifyDocument);
router.get('/read/:hash', sorobanController.readDocument);

// Whitelist / owner management (restricted)
router.get('/is_whitelisted/:address', /* public or restricted? - kept public */ sorobanController.isWhitelisted);

// Protected write ops: whitelist / remove_whitelist
router.post('/whitelist', requireAuth(['super_admin','regulator_admin']), sorobanController.whitelistAddress);
router.post('/remove_whitelist', requireAuth(['super_admin','regulator_admin']), sorobanController.removeFromWhitelist);

// Owner info / transfer
router.get('/owner', sorobanController.ownerAddress);
// Protected: transfer_ownership
router.post('/transfer_ownership', requireAuth(['super_admin']), sorobanController.transferOwnership);

// Wallet helpers (admin-only ops — were public; a public keygen/funding endpoint
// is an abuse vector, so locked down as part of the hardening).
router.post('/helpers/create_wallet', requireAuth(['super_admin', 'regulator_admin']), sorobanController.createWallet);
router.post('/helpers/fund_wallet', requireAuth(['super_admin', 'regulator_admin']), sorobanController.fundWallet);

// Init contract (owner) - protected
router.post('/init', requireAuth(['super_admin']), sorobanController.initContract);

module.exports = router;
