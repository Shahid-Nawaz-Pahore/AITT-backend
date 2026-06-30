// src/controllers/admin.controller.js — ops endpoints (job triggers, etc.)
const { runExpiryJob } = require('../services/jobs/expiry.job');
const logger = require('../utils/logger');

async function runExpiry(req, res, next) {
  try {
    const warnWithinDays = req.body?.warnWithinDays != null ? Number(req.body.warnWithinDays) : 30;
    const result = await runExpiryJob({ warnWithinDays });
    logger.info('Expiry job triggered via API', { by: req.user.sub, result });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { runExpiry };
