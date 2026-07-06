// src/models/AuditLog.js
// Lightweight request-level audit trail (P5). Every successful state-changing
// API call (POST/PUT/PATCH/DELETE) is recorded by audit.middleware. Chain-level
// auditing lives in Web3Tx; lifecycle events in CertificateEvent — this is the
// who-did-what-when across the whole API.
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  role: { type: String, default: null },
  method: { type: String, index: true },
  path: { type: String, index: true },
  statusCode: { type: Number },
  // 'success' (a completed mutation) | 'denied' (auth/authz failure — D13) |
  // 'error' (server error on a mutation). Indexed so security queries are cheap.
  outcome: { type: String, enum: ['success', 'denied', 'error'], default: 'success', index: true },
  ip: { type: String },
  durationMs: { type: Number },
}, { timestamps: true });

module.exports = mongoose.model('AuditLog', auditLogSchema);
