// src/models/Outbox.js
// ---------------------------------------------------------------------------
// Durable chain→DB mirror outbox (H3 #6). A confirmed on-chain write is a fact
// that MUST eventually be reflected in Mongo. writeThrough() persists a pending
// Outbox row IMMEDIATELY after the chain confirms (before attempting the mirror),
// so if the process dies between "chain write succeeded" and "DB mirror", the
// outbox processor replays the (idempotent) mirror until it succeeds. The chain
// is the source of truth; this guarantees at-least-once DB convergence.
// ---------------------------------------------------------------------------
const mongoose = require('mongoose');

// The mirror operations that can be replayed (must match indexer.MIRRORS keys).
const OUTBOX_OPS = [
  'mirrorStoredDocument',
  'mirrorIssuedCertificate',
  'mirrorReview',
  'mirrorRevocation',
  'mirrorCompanyApproved',
  'mirrorSubAdminActivated',
];

const outboxSchema = new mongoose.Schema({
  op: { type: String, enum: OUTBOX_OPS, required: true },
  payload: { type: Object, default: {} },      // mirror args (sans receipt)
  receipt: { type: Object, default: null },     // the chain receipt to replay with
  purpose: { type: String, default: null },     // Web3Tx purpose (for correlation)
  status: { type: String, enum: ['pending', 'done', 'failed'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 10 },
  nextAttemptAt: { type: Date, default: () => new Date(), index: true },
  lastError: { type: String, default: null },
  mirroredAt: { type: Date, default: null },
}, { timestamps: true });

outboxSchema.statics.OUTBOX_OPS = OUTBOX_OPS;

module.exports = mongoose.model('Outbox', outboxSchema);
module.exports.OUTBOX_OPS = OUTBOX_OPS;
