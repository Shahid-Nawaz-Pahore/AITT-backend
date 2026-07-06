// src/middlewares/audit.middleware.js
// Records API activity to the AuditLog. Mounted globally (routes/index) BEFORE
// the routers; the res 'finish' hook fires after the handler, so req.user (set
// by requireAuth) is available by then.
//
// Recorded events (D13 — audit auth FAILURES, not just successful mutations):
//   - success : a mutating request (POST/PUT/PATCH/DELETE) that returned 2xx/3xx
//   - denied  : ANY request that returned 401 / 403 / 429 (auth/authz/lockout/
//               rate-limit) — captures failed logins, forbidden access, etc.
//   - error   : a mutating request that returned 5xx
// Reads are not recorded (chain/lifecycle reads are high-volume + low-risk).
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DENIED = new Set([401, 403, 429]);

function classify(method, statusCode) {
  if (DENIED.has(statusCode)) return 'denied';
  if (MUTATING.has(method) && statusCode >= 200 && statusCode < 400) return 'success';
  if (MUTATING.has(method) && statusCode >= 500) return 'error';
  return null; // not audited (e.g. a successful GET, a 404)
}

function auditMiddleware(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const outcome = classify(req.method, res.statusCode);
    if (!outcome) return;
    AuditLog.create({
      actorUserId: req.user?.sub || null,
      role: req.user?.role || null,
      method: req.method,
      path: req.originalUrl ? req.originalUrl.split('?')[0] : req.path,
      statusCode: res.statusCode,
      outcome,
      ip: req.ip,
      durationMs: Date.now() - start,
    }).catch((e) => logger.warn('audit log write failed', { error: e.message }));
  });
  next();
}

module.exports = { auditMiddleware };
