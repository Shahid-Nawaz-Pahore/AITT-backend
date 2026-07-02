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

// Check if cert is issued (upload file to check)
router.post('/check', 
    certificatesController.upload.single('file'), certificatesController.checkCertificateIssued);

// Get a certificate (requires auth or optional) - public/semi-public access
router.get('/:id', authenticateOptional, certificatesController.getCertificate);

// NOTE (P1 / BE-C1): the broken POST /:id/issue and POST /:id/validate routes
// were removed with their handlers. The review-gated issue flow is rebuilt in
// P3 under /documents/:id/issue (no separate validate step exists on-chain).

// Public verify (no auth required)
router.get('/:id/verify', certificatesController.verifyPublic);

module.exports = router;