// src/routes/governance.routes.js — /api/v1/governance (N-of-M settings)
const express = require('express');
const router = express.Router();
const governanceController = require('../controllers/governance.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

const GOVERNORS = ['super_admin', 'regulator_admin', 'sub_admin'];

// Current { required, total, signerWallets }.
router.get('/', requireAuth(GOVERNORS), governanceController.getGovernance);

// Directly set N (and optionally M) -> set_threshold on chain (admin only). N<=M.
router.put('/', requireAuth(['super_admin']), governanceController.setGovernance);

module.exports = router;
