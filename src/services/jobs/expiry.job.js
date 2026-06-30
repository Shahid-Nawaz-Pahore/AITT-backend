// src/services/jobs/expiry.job.js
// ---------------------------------------------------------------------------
// Expiry job (P5). Transitions issued certificates to `expired` once past their
// expiryAt, and raises monitoring alerts (critical for expired, warning for
// upcoming) + notifies the submitting user. Idempotent: dedupes alerts on an
// open expiry alert per document.
//
// On-chain, verify_document already reports Expired automatically; this keeps
// the DB projection + alerts in sync proactively (and feeds the dashboard).
//
// Wire to a scheduler in production (e.g. node-cron or an external cron hitting
// POST /admin/jobs/expiry). Called directly in tests with an injected `now`.
// ---------------------------------------------------------------------------
const Certificate = require('../../models/Certificate');
const Alert = require('../../models/Alert');
const logger = require('../../utils/logger');
const { notify } = require('../../utils/notify');

async function ensureExpiryAlert({ cert, severity, message }) {
  const existing = await Alert.findOne({ docId: cert._id, kind: 'expiry', resolved: false });
  if (existing) {
    // Escalate an existing warning to critical if the cert has now expired.
    if (severity === 'critical' && existing.severity !== 'critical') {
      existing.severity = 'critical';
      existing.message = message;
      await existing.save();
    }
    return false;
  }
  await Alert.create({ docId: cert._id, message, dueDate: cert.expiryAt, severity, kind: 'expiry' });
  return true;
}

async function runExpiryJob({ warnWithinDays = 30, now = new Date() } = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const warnCutoff = new Date(nowDate.getTime() + warnWithinDays * 24 * 60 * 60 * 1000);

  let expired = 0;
  let warned = 0;
  let alertsCreated = 0;

  // 1) Expire issued certs that are past their expiry.
  const past = await Certificate.find({ status: 'issued', expiryAt: { $lte: nowDate } });
  for (const cert of past) {
    cert.status = 'expired';
    cert.chain = cert.chain || {};
    cert.chain.certificateStatus = 'Expired';
    // eslint-disable-next-line no-await-in-loop
    await cert.save();
    expired += 1;

    // eslint-disable-next-line no-await-in-loop
    const created = await ensureExpiryAlert({
      cert, severity: 'critical',
      message: `Certificate "${cert.certificateName}" has expired`,
    });
    if (created) alertsCreated += 1;

    if (cert.requestedByUserId) {
      // eslint-disable-next-line no-await-in-loop
      await notify({
        userId: cert.requestedByUserId, type: 'expiry', title: 'Certificate expired',
        message: `"${cert.certificateName}" has expired and is no longer valid.`,
        entityType: 'document', entityId: String(cert._id),
      });
    }
  }

  // 2) Warn for upcoming expiries within the window.
  const upcoming = await Certificate.find({ status: 'issued', expiryAt: { $gt: nowDate, $lte: warnCutoff } });
  for (const cert of upcoming) {
    // eslint-disable-next-line no-await-in-loop
    const created = await ensureExpiryAlert({
      cert, severity: 'warning',
      message: `Certificate "${cert.certificateName}" expires on ${new Date(cert.expiryAt).toISOString().slice(0, 10)}`,
    });
    if (created) { warned += 1; alertsCreated += 1; }
  }

  logger.info('Expiry job complete', { expired, warned, alertsCreated });
  return { expired, warned, alertsCreated };
}

module.exports = { runExpiryJob };
