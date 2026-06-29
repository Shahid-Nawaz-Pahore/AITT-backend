const express = require('express');
const router = express.Router();
const companyController = require('../controllers/company.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

// Create new company (maybe limited to super_admin later)
router.post('/', requireAuth(['super_admin']), companyController.createCompany);

// List all companies
router.get('/', requireAuth(['super_admin', 'regulator_admin','company_admin']), companyController.listCompanies);
router.get('/with-users', requireAuth(['super_admin', 'regulator_admin']), companyController.listCompaniesWithUsers);

// Get single company
router.get('/:id', requireAuth(['super_admin', 'regulator_admin', 'company_admin']), companyController.getCompany);

module.exports = router;
