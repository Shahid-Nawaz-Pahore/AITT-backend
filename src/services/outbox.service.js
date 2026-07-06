// src/services/outbox.service.js
// ---------------------------------------------------------------------------
// Outbox processor (H3 #6). Replays pending chain→DB mirror rows (models/Outbox)
// with exponential backoff until they converge, so a mirror that failed inline
// (crash / transient DB error after the chain confirmed) is self-healed. Mirror
// ops are idempotent (upsert by metadataHash / set-status), so re-running is safe.
// Scheduled by services/scheduler under a distributed lock; also invokable via
// POST /admin/jobs/outbox and directly in tests with an injected `now`.
// ---------------------------------------------------------------------------
const Outbox = require('../models/Outbox');
const indexer = require('./indexer.service');
const logger = require('../utils/logger');

const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;

/**
 * processOutbox({ limit, now }) — process due pending rows once. Returns a
 * summary { processed, done, failed, retried }.
 */
async function processOutbox({ limit = 50, now = new Date() } = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const due = await Outbox.find({ status: 'pending', nextAttemptAt: { $lte: nowDate } })
    .sort({ createdAt: 1 })
    .limit(limit);

  let processed = 0;
  let done = 0;
  let failed = 0;
  let retried = 0;

  for (const row of due) {
    processed += 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      await indexer.runMirror(row.op, row.payload, row.receipt);
      row.status = 'done';
      row.mirroredAt = new Date();
      row.lastError = null;
      // eslint-disable-next-line no-await-in-loop
      await row.save();
      done += 1;
    } catch (err) {
      row.attempts += 1;
      row.lastError = String(err.message).slice(0, 300);
      if (row.attempts >= row.maxAttempts) {
        row.status = 'failed'; // dead-letter — reconcile / ops attention
        failed += 1;
      } else {
        const backoff = Math.min(BACKOFF_BASE_MS * 2 ** row.attempts, BACKOFF_MAX_MS);
        row.nextAttemptAt = new Date(nowDate.getTime() + backoff);
        retried += 1;
      }
      // eslint-disable-next-line no-await-in-loop
      await row.save();
      logger.warn('outbox mirror attempt failed', { op: row.op, attempts: row.attempts, status: row.status, error: row.lastError });
    }
  }

  if (processed) logger.info('Outbox processed', { processed, done, failed, retried });
  return { processed, done, failed, retried };
}

/** pendingCount() — number of rows still awaiting mirror (for /ready + metrics). */
async function pendingCount() {
  return Outbox.countDocuments({ status: 'pending' });
}

/** deadLetterCount() — rows that exhausted retries (need attention). */
async function deadLetterCount() {
  return Outbox.countDocuments({ status: 'failed' });
}

module.exports = { processOutbox, pendingCount, deadLetterCount };
