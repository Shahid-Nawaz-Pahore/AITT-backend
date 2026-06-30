// src/controllers/template.controller.js
const templateService = require('../services/template.service');
const logger = require('../utils/logger');

async function listTemplates(req, res, next) {
  try {
    const { page = 1, limit = 50 } = req.query;
    res.json({ success: true, ...(await templateService.listTemplates({ page, limit })) });
  } catch (err) { next(err); }
}

async function getTemplate(req, res, next) {
  try {
    res.json({ success: true, data: await templateService.getTemplate(req.params.id) });
  } catch (err) { next(err); }
}

async function createTemplate(req, res, next) {
  try {
    const { name, description, file } = req.body || {};
    res.status(201).json({ success: true, data: await templateService.createTemplate({ name, description, file }) });
  } catch (err) { logger.error('createTemplate failed', { error: err.message }); next(err); }
}

async function updateTemplate(req, res, next) {
  try {
    const { name, description, file } = req.body || {};
    res.json({ success: true, data: await templateService.updateTemplate(req.params.id, { name, description, file }) });
  } catch (err) { next(err); }
}

async function removeTemplate(req, res, next) {
  try {
    res.json({ success: true, ...(await templateService.removeTemplate(req.params.id)) });
  } catch (err) { next(err); }
}

async function downloadTemplate(req, res, next) {
  try {
    const { filename, mimeType, buffer } = await templateService.buildDownload(req.params.id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.end(buffer);
  } catch (err) { return next(err); }
}

module.exports = { listTemplates, getTemplate, createTemplate, updateTemplate, removeTemplate, downloadTemplate };
