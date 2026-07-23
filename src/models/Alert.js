// src/models/Alert.js
// ---------------------------------------------------------------------------
// A monitoring alert (e.g. an upcoming certificate expiry). Mirrors
// frontend-aitt/src/mock/types.ts -> `Alert`
// (id, docId, message, dueDate, severity).
//
// The expiry job (P5) creates `expiry` alerts; resolving an alert removes it
// from the active feed (frontend resolveAlert), modeled here as a `resolved`
// flag so we keep an audit trail instead of hard-deleting.
// ---------------------------------------------------------------------------
const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  // The related document (Certificate). Stored as ObjectId ref, surfaced to the
  // frontend as the string `docId`.
  // Optional: a manual regulatory update (monitoring notice) isn't tied to a document.
  docId: { type: mongoose.Schema.Types.ObjectId, ref: 'Certificate', required: false, default: null, index: true },

  message: { type: String, required: true },
  // Optional effective date; defaults to now when omitted.
  dueDate: { type: Date, required: false, default: Date.now },
  severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info', index: true },

  // Categorize the source so the expiry job can avoid duplicate alerts.
  kind: { type: String, enum: ['expiry', 'review', 'governance', 'other'], default: 'other', index: true },

  resolved: { type: Boolean, default: false, index: true },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Alert', alertSchema);
