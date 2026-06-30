// src/middlewares/audit.middleware.js
// Records every successful mutating request to the AuditLog. Mounted globally
// (routes/index) BEFORE the routers; the res 'finish' hook fires after the
// route handler, so req.user (set by requireAuth) is available by then.
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function auditMiddleware(req, res, next) {
  if (!MUTATING.has(req.method)) return next();
  const start = Date.now();
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 400) return; // only successful mutations
    AuditLog.create({
      actorUserId: req.user?.sub || null,
      role: req.user?.role || null,
      method: req.method,
      path: req.originalUrl ? req.originalUrl.split('?')[0] : req.path,
      statusCode: res.statusCode,
      ip: req.ip,
      durationMs: Date.now() - start,
    }).catch((e) => logger.warn('audit log write failed', { error: e.message }));
  });
  next();
}

module.exports = { auditMiddleware };
