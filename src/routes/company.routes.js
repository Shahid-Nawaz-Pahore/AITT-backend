const express = require('express');
const router = express.Router();
const companyController = require('../controllers/company.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const { sensitiveLimiter } = require('../middlewares/rateLimiters');

// Public self-registration (frontend addCompany) -> PENDING company + admin login.
// Rate-limited (E-audit M5): each call creates a Company + User + a custodial
// keypair, so it must be throttled against mass/abusive registration.
router.post('/register', sensitiveLimiter, companyController.registerCompany);

// Create new company (admin-managed)
router.post('/', requireAuth(['super_admin']), companyController.createCompany);

// Frontend-shaped, paginated list with document counts.
router.get('/', requireAuth(['super_admin', 'regulator_admin', 'sub_admin', 'company_admin']), companyController.listCompaniesSerialized);
router.get('/with-users', requireAuth(['super_admin', 'regulator_admin', 'sub_admin']), companyController.listCompaniesWithUsers);

// Approve a pending company -> whitelist_address on chain -> active (admin only).
router.post('/:id/approve', requireAuth(['super_admin']), companyController.approveCompany);

// Remove a company (admin only).
router.delete('/:id', requireAuth(['super_admin']), companyController.removeCompany);

// Get single company
router.get('/:id', requireAuth(['super_admin', 'regulator_admin', 'sub_admin', 'company_admin']), companyController.getCompany);

module.exports = router;
