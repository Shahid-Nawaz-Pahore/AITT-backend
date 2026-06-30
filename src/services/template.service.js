// src/services/template.service.js
// ---------------------------------------------------------------------------
// Document templates (P5). Direct admin CRUD (templates are downloadable blanks,
// not a §3 multi-sig concern). Plus a .docx download: if a real file is stored
// we serve it, otherwise we generate a minimal blank .docx on the fly.
// ---------------------------------------------------------------------------
const fs = require('fs');
const Template = require('../models/Template');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { buildDocx } = require('../utils/docx');
const { paginate } = require('../utils/serializers');

function toTemplate(t) {
  if (!t) return null;
  const o = typeof t.toObject === 'function' ? t.toObject() : t;
  return { id: String(o._id), name: o.name, description: o.description || '', file: o.file };
}

function safeDocxName(name) {
  const base = String(name || 'template').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'template';
  return `${base}.docx`;
}

async function listTemplates({ page = 1, limit = 50 } = {}) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const [items, total] = await Promise.all([
    Template.find({}).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Template.countDocuments({}),
  ]);
  return paginate(items.map(toTemplate), { page, limit, total });
}

async function getTemplate(id) {
  const t = await Template.findById(id);
  if (!t) throw new AppError(404, 'Template not found');
  return toTemplate(t);
}

async function createTemplate({ name, description = '', file = null }) {
  if (!name) throw new AppError(400, 'name is required');
  const t = await Template.create({ name, description, file: file || safeDocxName(name) });
  logger.info('Template created', { id: t._id, name });
  return toTemplate(t);
}

async function updateTemplate(id, { name, description, file }) {
  const update = {};
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  if (file !== undefined) update.file = file;
  const t = await Template.findByIdAndUpdate(id, { $set: update }, { new: true });
  if (!t) throw new AppError(404, 'Template not found');
  return toTemplate(t);
}

async function removeTemplate(id) {
  const t = await Template.findById(id);
  if (!t) throw new AppError(404, 'Template not found');
  // Clean up a stored file if present.
  if (t.storage?.path) { try { fs.unlinkSync(t.storage.path); } catch (e) { /* ignore */ } }
  await Template.findByIdAndDelete(id);
  return { deleted: true };
}

/**
 * buildDownload — returns { filename, mimeType, buffer } for the template's
 * .docx. Serves the stored file if present; else generates a blank .docx.
 */
async function buildDownload(id) {
  const t = await Template.findById(id);
  if (!t) throw new AppError(404, 'Template not found');
  const filename = t.file || safeDocxName(t.name);
  const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  if (t.storage?.path && fs.existsSync(t.storage.path)) {
    return { filename, mimeType, buffer: fs.readFileSync(t.storage.path) };
  }
  const buffer = buildDocx({
    title: t.name,
    paragraphs: [t.description || '', '', 'This is a blank AITT compliance template. Fill in the required sections and submit for review.'],
  });
  return { filename, mimeType, buffer };
}

module.exports = { listTemplates, getTemplate, createTemplate, updateTemplate, removeTemplate, buildDownload, toTemplate };
