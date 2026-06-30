// src/controllers/audit.controller.js
const auditService = require('../services/audit.service');

async function listAudit(req, res, next) {
  try {
    const { page = 1, limit = 50, actorUserId, method } = req.query;
    res.json({ success: true, ...(await auditService.listAudit({ page, limit, actorUserId, method })) });
  } catch (err) { next(err); }
}

module.exports = { listAudit };
