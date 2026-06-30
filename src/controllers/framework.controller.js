// src/controllers/framework.controller.js — read-only (writes go via governance)
const frameworkService = require('../services/framework.service');

async function listFrameworks(req, res, next) {
  try {
    const { page = 1, limit = 50, activeOnly } = req.query;
    const result = await frameworkService.listFrameworks({
      page, limit, activeOnly: activeOnly === undefined ? true : activeOnly !== 'false',
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}

async function getFramework(req, res, next) {
  try {
    res.json({ success: true, data: await frameworkService.getFramework(req.params.id) });
  } catch (err) { next(err); }
}

module.exports = { listFrameworks, getFramework };
