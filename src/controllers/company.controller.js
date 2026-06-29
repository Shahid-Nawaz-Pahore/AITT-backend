const companyService = require('../services/company.service');
const logger = require('../utils/logger');

async function createCompany(req, res, next) {
  try {
    const data = req.body;
    const company = await companyService.createCompany(data);
    logger.info('Company created', { companyId: company._id });
    res.status(201).json({ success: true, data: company });
  } catch (err) {
    logger.error('Company creation failed', { error: err.message });
    next(err);
  }
}
async function listCompaniesWithUsers(req, res, next) {
  try {
    const companies = await companyService.listCompaniesWithUsers();      
    res.json({ success: true, data: companies });
  } catch (err) {
    next(err);
  }
}

async function listCompanies(req, res, next) {
  try {
    const companies = await companyService.listCompanies();
    res.json({ success: true, data: companies });
  } catch (err) {
    next(err);
  }
}

async function getCompany(req, res, next) {
  try {
    const { id } = req.params;
    const company = await companyService.getCompanyById(id);
    if (!company) return res.status(404).json({ success: false, message: 'Company not found' });
    res.json({ success: true, data: company });
  } catch (err) {
    next(err);
  }
}

module.exports = { createCompany, listCompanies, getCompany, listCompaniesWithUsers };
