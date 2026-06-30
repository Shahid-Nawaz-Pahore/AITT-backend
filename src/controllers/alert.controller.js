// src/controllers/alert.controller.js
const alertService = require('../services/alert.service');

async function listAlerts(req, res, next) {
  try {
    const { page = 1, limit = 50, includeResolved } = req.query;
    res.json({ success: true, ...(await alertService.listAlerts({ page, limit, includeResolved: includeResolved === 'true' })) });
  } catch (err) { next(err); }
}

async function resolveAlert(req, res, next) {
  try {
    res.json({ success: true, data: await alertService.resolveAlert(req.params.id) });
  } catch (err) { next(err); }
}

async function createAlert(req, res, next) {
  try {
    const { docId, message, dueDate, severity, kind } = req.body || {};
    res.status(201).json({ success: true, data: await alertService.createAlert({ docId, message, dueDate, severity, kind }) });
  } catch (err) { next(err); }
}

module.exports = { listAlerts, resolveAlert, createAlert };
