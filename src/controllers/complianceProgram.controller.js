// src/controllers/complianceProgram.controller.js
const svc = require('../services/complianceProgram.service');

async function list(req, res, next) {
  try {
    const { page = 1, limit = 100, type, jurisdiction, includeArchived } = req.query;
    res.json({
      success: true,
      ...(await svc.listPrograms({ page, limit, type, jurisdiction, includeArchived: includeArchived === 'true' })),
    });
  } catch (err) { next(err); }
}

async function get(req, res, next) {
  try { res.json({ success: true, data: await svc.getProgram(req.params.id) }); } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const { name, type, jurisdiction, description } = req.body || {};
    res.status(201).json({ success: true, data: await svc.createProgram({ name, type, jurisdiction, description }) });
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const { name, type, jurisdiction, description } = req.body || {};
    res.json({ success: true, data: await svc.updateProgram(req.params.id, { name, type, jurisdiction, description }) });
  } catch (err) { next(err); }
}

async function archive(req, res, next) {
  try {
    const archived = req.body && req.body.archived !== undefined ? !!req.body.archived : true;
    res.json({ success: true, data: await svc.setArchived(req.params.id, archived) });
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try { res.json({ success: true, data: await svc.deleteProgram(req.params.id) }); } catch (err) { next(err); }
}

async function assign(req, res, next) {
  try {
    const { subAdminIds } = req.body || {};
    res.json({ success: true, data: await svc.assignSubAdmins(req.params.id, subAdminIds) });
  } catch (err) { next(err); }
}

module.exports = { list, get, create, update, archive, remove, assign };
