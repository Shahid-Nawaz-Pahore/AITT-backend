// src/services/regulator.service.js
const Regulator = require('../models/Regulator');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

/**
 * Create a regulator. If session provided, create inside session.
 * @param {Object} data
 * @param {Object} options - { session }
 */
async function createRegulator(data, options = {}) {
  try {
    if (!data || !data.name) {
      throw new AppError(400, 'Regulator name is required');
    }

    if (options.session) {
      const [doc] = await Regulator.create([data], { session: options.session });
      logger.info('Regulator created (session)', { regulatorId: doc._id, name: doc.name });
      return doc;
    }

    const doc = await Regulator.create(data);
    logger.info('Regulator created', { regulatorId: doc._id, name: doc.name });
    return doc;
  } catch (err) {
    logger.error('createRegulator failed', { err: err.message });
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'Failed to create regulator', err.message);
  }
}

async function getRegulatorById(id) {
  const doc = await Regulator.findById(id);
  if (!doc) throw new AppError(404, 'Regulator not found');
  return doc;
}

async function listRegulators({ skip = 0, limit = 50, q = '' } = {}) {
  const filter = {};
  if (q) filter.name = new RegExp(q, 'i');
  const docs = await Regulator.find(filter).skip(parseInt(skip, 10)).limit(Math.min(100, limit));
  return docs;
}

module.exports = { createRegulator, getRegulatorById, listRegulators };
