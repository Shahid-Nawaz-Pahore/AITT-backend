// src/services/audit.service.js
const AuditLog = require('../models/AuditLog');
const { iso, paginate } = require('../utils/serializers');

function toAudit(a) {
  const o = typeof a.toObject === 'function' ? a.toObject() : a;
  return {
    id: String(o._id),
    actorUserId: o.actorUserId ? String(o.actorUserId) : null,
    role: o.role || null,
    method: o.method,
    path: o.path,
    statusCode: o.statusCode,
    ip: o.ip || null,
    durationMs: o.durationMs ?? null,
    at: iso(o.createdAt),
  };
}

async function listAudit({ page = 1, limit = 50, actorUserId = null, method = null } = {}) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const filter = {};
  if (actorUserId) filter.actorUserId = actorUserId;
  if (method) filter.method = String(method).toUpperCase();
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    AuditLog.countDocuments(filter),
  ]);
  return paginate(items.map(toAudit), { page, limit, total });
}

module.exports = { listAudit, toAudit };
