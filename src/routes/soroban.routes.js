// src/routes/soroban.routes.js
const express = require('express');
const router = express.Router();
const sorobanController = require('../controllers/soroban.controller');
const { requireAuth, authenticateOptional } = require('../middlewares/auth.middleware');

/*
  AUTH RULES:
  - Protected (requireAuth): init, transfer_ownership, whitelist, remove_whitelist
  - All other routes are public (no auth) per your request.
*/

// Write operations
// public: store_document (no auth)
router.post('/store_document', sorobanController.storeDocument);

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

// Wallet helpers (public)
router.post('/helpers/create_wallet', sorobanController.createWallet);
router.post('/helpers/fund_wallet', sorobanController.fundWallet);

// Init contract (owner) - protected
router.post('/init', requireAuth(['super_admin']), sorobanController.initContract);

module.exports = router;
