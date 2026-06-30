// src/controllers/subadmin.controller.js
const subadminService = require('../services/subadmin.service');
const logger = require('../utils/logger');

async function inviteSubAdmin(req, res, next) {
  try {
    const { name, email, password, wallet } = req.body || {};
    const sa = await subadminService.inviteSubAdmin({ name, email, password, wallet, invitedByUserId: req.user.sub });
    res.status(201).json({ success: true, data: sa });
  } catch (err) {
    logger.error('inviteSubAdmin failed', { error: err.message });
    next(err);
  }
}

async function activateSubAdmin(req, res, next) {
  try {
    const sa = await subadminService.activateSubAdmin(req.params.id, { adminUserId: req.user.sub });
    res.json({ success: true, data: sa });
  } catch (err) {
    logger.error('activateSubAdmin failed', { error: err.message, id: req.params.id });
    next(err);
  }
}

async function listSubAdmins(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await subadminService.listSubAdmins({ page, limit });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function removeSubAdmin(req, res, next) {
  try {
    const result = await subadminService.removeSubAdmin(req.params.id, { adminUserId: req.user.sub });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

module.exports = { inviteSubAdmin, activateSubAdmin, listSubAdmins, removeSubAdmin };
