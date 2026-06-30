// src/controllers/governance.controller.js
const governanceService = require('../services/governance.service');
const logger = require('../utils/logger');

async function getGovernance(req, res, next) {
  try {
    const data = await governanceService.getGovernance();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function setGovernance(req, res, next) {
  try {
    const { required, total } = req.body || {};
    const data = await governanceService.setGovernance({ required, total, adminUserId: req.user.sub });
    res.json({ success: true, data });
  } catch (err) {
    logger.error('setGovernance failed', { error: err.message });
    next(err);
  }
}

module.exports = { getGovernance, setGovernance };
