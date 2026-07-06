// src/models/JobLock.js
// ---------------------------------------------------------------------------
// Lightweight lease-based distributed lock (D12). A scheduled job acquires a
// named lock with a time-boxed lease before running, so across a multi-instance
// deploy only ONE instance runs the expiry/reconcile/outbox tick at a time.
// The lease auto-expires (lockedUntil in the past ⇒ free), so a crashed holder
// never wedges the lock forever.
// ---------------------------------------------------------------------------
const mongoose = require('mongoose');

const jobLockSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  owner: { type: String, default: null },       // instance id that holds it
  lockedUntil: { type: Date, default: null },    // lease expiry
  lastRunAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('JobLock', jobLockSchema);
