// src/controllers/document.controller.js
const fs = require('fs');
const documentService = require('../services/document.service');
const logger = require('../utils/logger');
const { paginate } = require('../utils/serializers');
const { isCompany } = require('../utils/roles');

// Read the uploaded file into a Buffer regardless of disk/memory multer mode.
function bufferFromReq(req) {
  if (req.file?.buffer) return req.file.buffer;
  if (req.file?.path) return fs.readFileSync(req.file.path);
  return null;
}

async function submitDocument(req, res, next) {
  try {
    const { subject } = req.body || {};
    const filename = req.body.filename || req.file?.originalname;
    if (!req.file) return res.status(400).json({ success: false, message: 'File is required' });
    if (!subject) return res.status(400).json({ success: false, message: 'subject is required' });

    // Company admins submit for their OWN company; admins may pass companyId.
    const companyId = isCompany(req.user.role) ? req.user.companyId : (req.body.companyId || req.user.companyId);

    const doc = await documentService.submitDocument({
      buffer: bufferFromReq(req),
      filename,
      subject,
      mimeType: req.file.mimetype,
      size: req.file.size,
      companyId,
      requestedByUserId: req.user.sub,
    });

    // Best-effort cleanup of any on-disk temp upload (we only need the hash).
    if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ } }

    return res.status(201).json({ success: true, data: doc });
  } catch (err) {
    if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ } }
    logger.error('submitDocument failed', { error: err.message });
    return next(err);
  }
}

async function listDocuments(req, res, next) {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const result = await documentService.listDocuments({ user: req.user, page, limit, status });
    return res.json({ success: true, ...paginate(result.items, result) });
  } catch (err) {
    return next(err);
  }
}

async function getDocument(req, res, next) {
  try {
    const doc = await documentService.getDocument({ id: req.params.id, user: req.user });
    return res.json({ success: true, data: doc });
  } catch (err) {
    return next(err);
  }
}

// Public certificate registry (no auth) — issued/revoked/expired certs only.
async function publicRegistry(req, res, next) {
  try {
    const { page = 1, limit = 100 } = req.query;
    const result = await documentService.listPublicRegistry({ page, limit });
    return res.json({ success: true, ...paginate(result.items, result) });
  } catch (err) {
    return next(err);
  }
}

async function reviewDocument(req, res, next) {
  try {
    const { decision, complianceScore, comment } = req.body || {};
    const doc = await documentService.reviewDocument({
      id: req.params.id,
      reviewerUserId: req.user.sub,
      decision,
      complianceScore,
      comment,
    });
    return res.json({ success: true, data: doc });
  } catch (err) {
    logger.error('reviewDocument failed', { error: err.message, id: req.params.id });
    return next(err);
  }
}

async function issueDocument(req, res, next) {
  try {
    const doc = await documentService.issueDocument({
      id: req.params.id,
      issuerUserId: req.user.sub,
      expiryAt: req.body?.expiryAt || null,
    });
    return res.json({ success: true, data: doc });
  } catch (err) {
    logger.error('issueDocument failed', { error: err.message, id: req.params.id });
    return next(err);
  }
}

async function verifyDocument(req, res, next) {
  try {
    const hashOrId = req.params.hash || req.params.id;
    const result = await documentService.verifyDocument({ hashOrId });
    return res.json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

async function downloadDocumentFile(req, res, next) {
  try {
    const { stream, filename, mimeType } = await documentService.getDocumentFile({ id: req.params.id, user: req.user });
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    stream.on('error', (e) => {
      logger.error('file stream error', { id: req.params.id, error: e.message });
      if (!res.headersSent) next(e);
      else res.destroy(e);
    });
    return stream.pipe(res);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  submitDocument,
  listDocuments,
  publicRegistry,
  getDocument,
  reviewDocument,
  issueDocument,
  verifyDocument,
  downloadDocumentFile,
};
