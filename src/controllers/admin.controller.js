// src/controllers/admin.controller.js — ops endpoints (job triggers, etc.)
const { runExpiryJob } = require('../services/jobs/expiry.job');
const { processOutbox, pendingCount, deadLetterCount } = require('../services/outbox.service');
const reconcile = require('../services/reconcile.service');
const logger = require('../utils/logger');

async function runExpiry(req, res, next) {
  try {
    const warnWithinDays = req.body?.warnWithinDays != null ? Number(req.body.warnWithinDays) : 30;
    const result = await runExpiryJob({ warnWithinDays });
    logger.info('Expiry job triggered via API', { by: req.user.sub, result });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// POST /admin/jobs/outbox — drain the durable chain→DB mirror outbox (H3 #6).
async function runOutbox(req, res, next) {
  try {
    const limit = req.body?.limit != null ? Math.min(500, Number(req.body.limit)) : 100;
    const result = await processOutbox({ limit });
    const [pending, deadLetter] = await Promise.all([pendingCount(), deadLetterCount()]);
    logger.info('Outbox drained via API', { by: req.user.sub, result });
    res.json({ success: true, data: { ...result, pending, deadLetter } });
  } catch (err) {
    next(err);
  }
}

// POST /admin/jobs/reconcile — reconcile chain↔DB (chain is source of truth).
async function runReconcile(req, res, next) {
  try {
    const fix = req.body?.fix !== false; // default: fix drift
    const certs = await reconcile.reconcileAllCertificates({ fix });
    const governance = await reconcile.reconcileGovernance({ fix });
    const proposals = await reconcile.reconcileProposals({ fix });
    logger.info('Reconcile triggered via API', { by: req.user.sub, drifted: certs.drifted, fixed: certs.fixed, proposalsFixed: proposals.fixed });
    res.json({ success: true, data: { certs, governance, proposals } });
  } catch (err) {
    next(err);
  }
}

module.exports = { runExpiry, runOutbox, runReconcile };
