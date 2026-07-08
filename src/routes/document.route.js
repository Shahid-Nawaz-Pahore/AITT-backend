// src/routes/document.route.js
// /api/v1/documents — the lifecycle surface for the approved frontend (DocItem).
const express = require('express');
const router = express.Router();
const documentController = require('../controllers/document.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const { uploadSingle } = require('../utils/upload');

const REVIEWER = ['sub_admin', 'regulator_admin', 'super_admin'];
const ANY_AUTH = ['company_admin', 'sub_admin', 'regulator_admin', 'super_admin'];

// Submit a document (company admin for own company; admin may target a company).
router.post('/', requireAuth(['company_admin', 'super_admin']), uploadSingle('file'), documentController.submitDocument);

// List (role-scoped: company sees own; reviewers/admins see all) + paginated.
router.get('/', requireAuth(ANY_AUTH), documentController.listDocuments);

// Public certificate registry (no auth) — issued/revoked/expired only.
// Registered before '/:id' so "registry" isn't captured as an id.
router.get('/registry', documentController.publicRegistry);

// Public verification (no auth) — by hash or by id.
router.get('/verify/:hash', documentController.verifyDocument);
router.get('/:id/verify', documentController.verifyDocument);

// Download the stored upload (role-scoped; disk-storage mode only).
router.get('/:id/file', requireAuth(ANY_AUTH), documentController.downloadDocumentFile);

// Detail.
router.get('/:id', requireAuth(ANY_AUTH), documentController.getDocument);

// Submit a review (sub-admin / admin). Enforces 0–100 + one-per-officer.
router.post('/:id/review', requireAuth(REVIEWER), documentController.reviewDocument);

// Issue (admin only). Enforces the review-before-issue gate.
router.post('/:id/issue', requireAuth(['super_admin']), documentController.issueDocument);

module.exports = router;
