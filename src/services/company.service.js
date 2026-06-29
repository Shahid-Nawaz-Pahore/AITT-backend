// src/services/company.service.js
const Company = require('../models/Company');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

/**
 * Create a company. If session provided, this will be created inside that session.
 * @param {Object} companyData
 * @param {Object} options - { session }
 */
async function createCompany(companyData, options = {}) {
  try {
    if (!companyData || !companyData.name) {
      throw new AppError(400, 'Company name is required');
    }

    if (options.session) {
      // create as array to use session
      const [doc] = await Company.create([companyData], { session: options.session });
      logger.info('Company created (session)', { companyId: doc._id, name: doc.name });
      return doc;
    }

    const doc = await Company.create(companyData);
    logger.info('Company created', { companyId: doc._id, name: doc.name });
    return doc;
  } catch (err) {
    logger.error('createCompany failed', { err: err.message });
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'Failed to create company', err.message);
  }
}

async function getCompanyById(id) {
  const doc = await Company.findById(id);
  if (!doc) throw new AppError(404, 'Company not found');
  return doc;
}

async function listCompaniesWithUsers() {
  try {
    const companies = await Company.aggregate([
      // (Optional) add filtering here if you want to exclude soft-deleted companies or similar
      { $sort: { createdAt: -1 } },

      // Lookup users that reference this company._id in their companyId
      {
        $lookup: {
          from: 'users', // collection name
          let: { companyId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$companyId', '$$companyId'] } } },
            {
              $project: {
                _id: 1,
                email: 1,
                role: 1,
                isActive: 1,
                walletAddress: 1,
                lastLoginAt: 1,
                createdAt: 1
              }
            },
            { $sort: { createdAt: -1 } } // newest users first (optional)
          ],
          as: 'users'
        }
      },

      // Project only important company fields + the users array
      {
        $project: {
          _id: 1,
          name: 1,
          contactEmail: 1,
          contactPhone: 1,
          walletAddress: 1,
          metadata: 1,
          createdAt: 1,
          updatedAt: 1,
          users: 1
        }
      }
    ]).allowDiskUse(true);

    logger.info('listCompaniesWithUsers: fetched companies with users', { companiesCount: companies.length });
    return companies;
  } catch (err) {
    logger.error('listCompaniesWithUsers failed', { err: err.message });
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'Failed to list companies with users', err.message);
  }
}

async function listCompanies({ skip = 0, limit = 50, q = '' } = {}) {
  const filter = {};
  if (q) filter.$text = { $search: q };
  const docs = await Company.find(filter).skip(parseInt(skip, 10)).limit(Math.min(100, limit));
  return docs;
}

module.exports = { createCompany, getCompanyById, listCompanies, listCompaniesWithUsers };
