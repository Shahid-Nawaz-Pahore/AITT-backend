// src/services/alert.service.js
// ---------------------------------------------------------------------------
// Monitoring alerts (P5). Mostly created by the expiry job; the API lists active
// alerts and resolves them (frontend resolveAlert -> we keep an audit trail via
// a `resolved` flag rather than hard-deleting).
// ---------------------------------------------------------------------------
const Alert = require('../models/Alert');
const AppError = require('../utils/AppError');
const { iso, paginate } = require('../utils/serializers');

function toAlert(a) {
  if (!a) return null;
  const o = typeof a.toObject === 'function' ? a.toObject() : a;
  return {
    id: String(o._id),
    docId: o.docId ? String(o.docId) : null,
    message: o.message,
    dueDate: iso(o.dueDate) || new Date(0).toISOString(),
    severity: o.severity || 'info',
  };
}

async function listAlerts({ page = 1, limit = 50, includeResolved = false } = {}) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const filter = includeResolved ? {} : { resolved: false };
  const [items, total] = await Promise.all([
    Alert.find(filter).sort({ dueDate: 1 }).skip((page - 1) * limit).limit(limit),
    Alert.countDocuments(filter),
  ]);
  return paginate(items.map(toAlert), { page, limit, total });
}

async function resolveAlert(id) {
  const a = await Alert.findById(id);
  if (!a) throw new AppError(404, 'Alert not found');
  a.resolved = true;
  a.resolvedAt = new Date();
  await a.save();
  return toAlert(a);
}

async function createAlert({ docId, message, dueDate, severity = 'info', kind = 'other' }) {
  if (!message || !dueDate) throw new AppError(400, 'message and dueDate are required');
  const a = await Alert.create({ docId, message, dueDate, severity, kind });
  return toAlert(a);
}

module.exports = { listAlerts, resolveAlert, createAlert, toAlert };
