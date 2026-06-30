const companyService = require('../services/company.service');
const logger = require('../utils/logger');

async function registerCompany(req, res, next) {
  try {
    const { name, email, password, contactPhone, wallet } = req.body || {};
    const company = await companyService.registerCompany({ name, email, password, contactPhone, wallet });
    res.status(201).json({ success: true, data: company });
  } catch (err) {
    logger.error('registerCompany failed', { error: err.message });
    next(err);
  }
}

async function approveCompany(req, res, next) {
  try {
    const company = await companyService.approveCompany(req.params.id, { approverUserId: req.user.sub });
    res.json({ success: true, data: company });
  } catch (err) {
    logger.error('approveCompany failed', { error: err.message, id: req.params.id });
    next(err);
  }
}

async function removeCompany(req, res, next) {
  try {
    const result = await companyService.removeCompany(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function listCompaniesSerialized(req, res, next) {
  try {
    const { page = 1, limit = 20, q = '' } = req.query;
    const result = await companyService.listCompaniesSerialized({ page, limit, q });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

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
    // Frontend-shaped (serialized) single company, with document count.
    const company = await companyService.getCompanySerialized(id);
    res.json({ success: true, data: company });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createCompany,
  listCompanies,
  getCompany,
  listCompaniesWithUsers,
  registerCompany,
  approveCompany,
  removeCompany,
  listCompaniesSerialized,
};
