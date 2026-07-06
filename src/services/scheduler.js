// src/services/scheduler.js
// ---------------------------------------------------------------------------
// Background scheduler (D12). Runs the outbox processor, the expiry job, and the
// chain↔DB reconcile on fixed intervals. Each tick executes under a lease-based
// distributed lock (utils/lock) so across a multi-instance deploy only ONE
// instance runs a given job at a time. Zero new deps (interval + Mongo lock is a
// deliberate "or equivalent" to node-cron — the multi-instance LOCK is the real
// requirement, and this keeps the production supply chain minimal).
//
// Enabled only when ENABLE_SCHEDULER=true (default: true in production, off in
// dev/test so `npm test` never starts timers). Timers are unref'd so they never
// keep the process alive on their own.
// ---------------------------------------------------------------------------
const { withLock } = require('../utils/lock');
const logger = require('../utils/logger');
const { runExpiryJob } = require('./jobs/expiry.job');
const { processOutbox } = require('./outbox.service');
const reconcile = require('./reconcile.service');

const bool = (v) => String(v).toLowerCase() === 'true';

let timers = [];

function registerInterval(name, intervalMs, leaseMs, fn) {
  const tick = async () => {
    try {
      await withLock(name, leaseMs, fn);
    } catch (err) {
      logger.error(`scheduler[${name}] tick failed`, { error: err && err.message });
    }
  };
  const t = setInterval(tick, intervalMs);
  if (t.unref) t.unref();
  timers.push({ name, timer: t });
}

/** startScheduler() — begin the interval jobs (no-op unless ENABLE_SCHEDULER=true). */
function startScheduler() {
  if (!bool(process.env.ENABLE_SCHEDULER)) {
    logger.info('Scheduler disabled (set ENABLE_SCHEDULER=true to enable background jobs)');
    return;
  }
  const outboxMs = Number(process.env.OUTBOX_JOB_INTERVAL_MS || 30000);
  const expiryMs = Number(process.env.EXPIRY_JOB_INTERVAL_MS || 3600000);
  const reconcileMs = Number(process.env.RECONCILE_JOB_INTERVAL_MS || 21600000);

  // Lease < interval, but generous enough to cover a normal run.
  registerInterval('outbox', outboxMs, Math.min(outboxMs, 60000), () => processOutbox({}));
  registerInterval('expiry', expiryMs, 5 * 60 * 1000, () => runExpiryJob({}));
  registerInterval('reconcile', reconcileMs, 10 * 60 * 1000, async () => {
    await reconcile.reconcileAllCertificates({ fix: true });
    await reconcile.reconcileGovernance({ fix: true });
    await reconcile.reconcileProposals({ fix: true });
  });

  logger.info('Scheduler started', { outboxMs, expiryMs, reconcileMs });
}

/** stopScheduler() — clear all interval timers (graceful shutdown / tests). */
function stopScheduler() {
  timers.forEach(({ timer }) => clearInterval(timer));
  timers = [];
}

module.exports = { startScheduler, stopScheduler };
