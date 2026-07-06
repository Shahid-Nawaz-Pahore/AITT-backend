const express = require('express');
const router = express.Router();
const certificatesController = require('../controllers/certificates.controller');
const { requireAuth, authenticateOptional } = require('../middlewares/auth.middleware');

// ==================== CRUD OPERATIONS (Super Admin Only) ====================

// GET all certificates (super_admin only) - with pagination, filtering, search
// SECURITY (audit C3): this admin endpoint was missing its auth guard, exposing
// the entire certificate collection to anyone. Now super_admin-only.
router.get('/admin/all', requireAuth(['super_admin']), certificatesController.getAllCertificates);

// GET single certificate by ID (super_admin only) - with full details and relations
router.get('/admin/:id', requireAuth(['super_admin']), certificatesController.getCertificateById);

// POST create certificate (super_admin only)
router.post('/', requireAuth(['super_admin','regulator_admin']), 
    certificatesController.uploadMiddleware, certificatesController.createCertificate);

// PUT update certificate (super_admin only) - can update name/subject and optionally replace file
router.put('/admin/:id', requireAuth(['super_admin']), 
    certificatesController.uploadMiddleware, certificatesController.updateCertificate);

// DELETE certificate (super_admin only) - complete cleanup of certificate and related records
router.delete('/admin/:id', requireAuth(['super_admin']), certificatesController.deleteCertificate);

// ==================== EXISTING CERTIFICATE OPERATIONS ====================

// Check if cert is issued (upload file to check). Authenticated + size-bounded
// (E-audit H2): was public with an unbounded in-memory multer (OOM DoS).
router.post('/check',
    requireAuth(['super_admin', 'regulator_admin', 'sub_admin', 'company_admin']),
    certificatesController.upload.single('file'), certificatesController.checkCertificateIssued);

// Get a certificate — AUTHENTICATED + tenant-scoped (E-audit H1). Was
// authenticateOptional (anonymous), which leaked full reviews/PII/paths. Public
// authenticity checks use GET /:id/verify (minimal shape) instead.
router.get('/:id', requireAuth(['super_admin', 'regulator_admin', 'sub_admin', 'company_admin']), certificatesController.getCertificate);

// NOTE (P1 / BE-C1): the broken POST /:id/issue and POST /:id/validate routes
// were removed with their handlers. The review-gated issue flow is rebuilt in
// P3 under /documents/:id/issue (no separate validate step exists on-chain).

// Public verify (no auth required)
router.get('/:id/verify', certificatesController.verifyPublic);

module.exports = router;