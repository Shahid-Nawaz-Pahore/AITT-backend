// src/routes/proposal.routes.js — /api/v1/proposals (multi-sig governance)
const express = require('express');
const router = express.Router();
const proposalController = require('../controllers/proposal.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

const GOVERNORS = ['super_admin', 'regulator_admin', 'sub_admin'];

// Create a proposal (main admin or sub-admin). NOTE: creating != signing — the
// on-chain proposal starts with 0 approvals; sign separately to approve.
router.post('/', requireAuth(GOVERNORS), proposalController.createProposal);

// List / detail (governors).
router.get('/', requireAuth(GOVERNORS), proposalController.listProposals);
router.get('/:id', requireAuth(GOVERNORS), proposalController.getProposal);

// Sign/approve (sub-admins; service enforces). Auto-executes at threshold on-chain.
router.post('/:id/sign', requireAuth(GOVERNORS), proposalController.signProposal);

// Reject (backend-only state; admin only).
router.post('/:id/reject', requireAuth(['super_admin']), proposalController.rejectProposal);

module.exports = router;
