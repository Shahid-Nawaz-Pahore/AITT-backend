// src/services/reconcile.service.js
// ---------------------------------------------------------------------------
// chain <-> DB reconcile helper (build brief P2). The write-through indexer
// keeps Mongo in sync on the happy path; this is the safety net that detects &
// (optionally) repairs drift — e.g. a tx that confirmed after our process died,
// an on-chain expiry that elapsed, or a governance threshold changed directly.
//
// Source of truth is the chain (via the adapter). With { fix: true } the DB is
// updated to match; otherwise drift is only reported.
// ---------------------------------------------------------------------------
const Certificate = require('../models/Certificate');
const GovernanceConfig = require('../models/GovernanceConfig');
const logger = require('../utils/logger');
const { composeStatus, latestReview } = require('../utils/composeStatus');
const { getAdapter } = require('./sorobanAdapter');

function expiryToDate(expiry) {
  const n = Number(expiry);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

/**
 * reconcileCertificate(metadataHash, { adapter, fix }) — compare one document's
 * on-chain lifecycle to the DB and report (or fix) drift.
 */
async function reconcileCertificate(metadataHash, { adapter = getAdapter(), fix = false } = {}) {
  const [chainDoc, cert] = await Promise.all([
    adapter.verifyDocument(metadataHash),
    Certificate.findOne({ metadataHash }),
  ]);

  const result = { metadataHash, inSync: true, drift: {}, fixed: false };

  if (!chainDoc && !cert) { result.drift.missing = 'both'; result.inSync = false; return result; }
  if (chainDoc && !cert) { result.drift.missing = 'db'; result.inSync = false; return result; }
  if (!chainDoc && cert) { result.drift.missing = 'chain'; result.inSync = false; return result; }

  const chainLifecycle = chainDoc.certificate_status; // effective (incl. Expired)
  const review = latestReview(cert.reviews);
  const expectedStatus = composeStatus(chainLifecycle, review ? review.decision : null, { inReview: !!cert.inReview });
  const expectedExpiry = expiryToDate(chainDoc.expiry);

  if (cert.chain?.certificateStatus !== chainLifecycle) {
    result.drift.certificateStatus = { db: cert.chain?.certificateStatus ?? null, chain: chainLifecycle };
  }
  if (cert.status !== expectedStatus) {
    result.drift.status = { db: cert.status, expected: expectedStatus };
  }
  const dbExpiryMs = cert.expiryAt ? new Date(cert.expiryAt).getTime() : null;
  const chExpiryMs = expectedExpiry ? expectedExpiry.getTime() : null;
  if (dbExpiryMs !== chExpiryMs) {
    result.drift.expiryAt = { db: cert.expiryAt ?? null, chain: expectedExpiry ?? null };
  }

  result.inSync = Object.keys(result.drift).length === 0;

  if (!result.inSync && fix) {
    cert.chain = cert.chain || {};
    cert.chain.certificateStatus = chainLifecycle;
    if (expectedExpiry) cert.expiryAt = expectedExpiry;
    cert.status = expectedStatus;
    await cert.save();
    result.fixed = true;
    logger.info('reconcileCertificate fixed drift', { metadataHash: metadataHash.slice(0, 12), drift: result.drift });
  }
  return result;
}

/**
 * reconcileAllCertificates({ adapter, fix, limit, filter }) — reconcile every
 * anchored certificate (those with a metadataHash). Returns a summary.
 */
async function reconcileAllCertificates({ adapter = getAdapter(), fix = false, limit = 500, filter = {} } = {}) {
  const certs = await Certificate.find({ metadataHash: { $ne: null }, ...filter })
    .select('metadataHash')
    .limit(limit)
    .lean();

  const details = [];
  let inSync = 0;
  let drifted = 0;
  let fixed = 0;

  for (const c of certs) {
    // eslint-disable-next-line no-await-in-loop
    const r = await reconcileCertificate(c.metadataHash, { adapter, fix });
    if (r.inSync) inSync += 1;
    else { drifted += 1; if (r.fixed) fixed += 1; details.push(r); }
  }

  return { total: certs.length, inSync, drifted, fixed, details };
}

/**
 * reconcileGovernance({ adapter, fix }) — compare GovernanceConfig.required (N)
 * to the on-chain governance_threshold and report (or fix) drift.
 */
async function reconcileGovernance({ adapter = getAdapter(), fix = false } = {}) {
  const [chainThreshold, cfg] = await Promise.all([
    adapter.governanceThreshold(),
    GovernanceConfig.getSingleton(),
  ]);

  const inSync = Number(cfg.required) === Number(chainThreshold);
  const result = { chainThreshold: Number(chainThreshold), dbRequired: Number(cfg.required), inSync, fixed: false };

  if (!inSync && fix) {
    cfg.required = Number(chainThreshold);
    if (cfg.total < cfg.required) cfg.total = cfg.required; // keep N <= M invariant
    cfg.lastSyncedThreshold = Number(chainThreshold);
    await cfg.save();
    result.fixed = true;
    logger.info('reconcileGovernance fixed drift', result);
  }
  return result;
}

module.exports = {
  reconcileCertificate,
  reconcileAllCertificates,
  reconcileGovernance,
};
