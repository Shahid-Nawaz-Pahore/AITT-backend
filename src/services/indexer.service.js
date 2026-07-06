// src/services/indexer.service.js
// ---------------------------------------------------------------------------
// Write-through indexer (build brief P2). Under the custodial model (A2) the
// backend submits every tx, so after a SUCCESSFUL adapter write we mirror the
// resulting state straight into Mongo — no event subscription needed.
//
// Two responsibilities:
//   1. recordTx()  — persist a Web3Tx audit row for every adapter write.
//   2. mirror*()   — project the new chain state onto our DB models, recomputing
//                    the composed 9-status + overall complianceScore (latest
//                    wins, A6) and stamping the per-step chain.txHash anchors.
//
// `writeThrough()` ties them together: call adapter -> recordTx -> mirror.
// Higher-level P3/P4 services use these so all DB/chain mutations stay in sync.
// ---------------------------------------------------------------------------
const Certificate = require('../models/Certificate');
const Company = require('../models/Company');
const SubAdmin = require('../models/SubAdmin');
const Web3Tx = require('../models/Web3Tx');
const Outbox = require('../models/Outbox');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {
  composeStatus,
  latestReview,
  overallComplianceScore,
} = require('../utils/composeStatus');

// Map an adapter receipt to a Web3Tx status. Stub receipts are 'simulated';
// real receipts confirm on SUCCESS, else fail.
function txStatusFromReceipt(receipt) {
  if (!receipt) return 'failed';
  if (receipt.source === 'stub' || receipt.status === 'simulated') return 'simulated';
  return receipt.status === 'SUCCESS' ? 'confirmed' : 'failed';
}

/**
 * recordTx — persist a Web3Tx row for an adapter write. Best-effort: logs and
 * returns null on failure so a bookkeeping error never rolls back a real tx.
 */
async function recordTx({
  purpose,
  receipt,
  method = null,
  certificateId = null,
  proposalId = null,
  submittedByUserId = null,
  network = 'testnet',
  requestDump = null,
}) {
  try {
    return await Web3Tx.create({
      network,
      purpose,
      method: method || (receipt && receipt.method) || null,
      certificateId,
      proposalId,
      submittedByUserId,
      txHash: receipt && receipt.hash,
      ledger: receipt && receipt.ledger,
      latencyMs: receipt && receipt.latencyMs,
      status: txStatusFromReceipt(receipt),
      source: (receipt && receipt.source) || 'real',
      requestDump,
      responseDump: receipt,
    });
  } catch (err) {
    logger.error('recordTx failed', { purpose, error: err.message });
    return null;
  }
}

/**
 * recomputeCertificateFields(cert) — recompute the composed status + overall
 * compliance score from the on-chain lifecycle + embedded reviews. Mutates and
 * returns the (sub)document; caller saves.
 */
function recomputeCertificateFields(cert) {
  const lifecycle = cert.chain?.certificateStatus || 'Submitted';
  const review = latestReview(cert.reviews);
  cert.complianceScore = overallComplianceScore(cert.reviews);
  cert.status = composeStatus(lifecycle, review ? review.decision : null, { inReview: !!cert.inReview });
  return cert;
}

/**
 * mirrorStoredDocument — after store_document succeeds, upsert the Certificate.
 * Idempotent on metadataHash (mirrors the contract's unique-hash rule).
 */
async function mirrorStoredDocument({
  metadataHash,
  certificateName,
  subject,
  companyId = null,
  requestedByUserId = null,
  receipt,
  network = 'testnet',
}) {
  let cert = await Certificate.findOne({ metadataHash });
  if (!cert) {
    cert = new Certificate({ metadataHash, certificateName, subject, companyId, requestedByUserId });
  }
  cert.chain = cert.chain || {};
  cert.chain.certificateStatus = 'Submitted';
  cert.chain.network = network;
  if (receipt) cert.chain.txHashStore = receipt.hash;
  recomputeCertificateFields(cert);
  await cert.save();
  return cert;
}

/**
 * mirrorIssuedCertificate — after issue_certificate succeeds.
 * expiryUnix is the on-chain expiry (unix seconds); we store expiryAt as a Date.
 */
async function mirrorIssuedCertificate({ metadataHash, expiryUnix = null, expiryAt = null, receipt }) {
  const cert = await Certificate.findOne({ metadataHash });
  if (!cert) throw new AppError(404, 'Certificate not found for issue mirror', metadataHash);
  cert.chain = cert.chain || {};
  cert.chain.certificateStatus = 'Issued';
  if (receipt) cert.chain.txHashIssue = receipt.hash;
  if (expiryAt) cert.expiryAt = expiryAt;
  else if (expiryUnix) cert.expiryAt = new Date(Number(expiryUnix) * 1000);
  recomputeCertificateFields(cert);
  await cert.save();
  return cert;
}

/**
 * mirrorReview — after submit_review succeeds. One review per reviewer (latest
 * replaces prior, mirroring the contract's per-reviewer overwrite — gap #6).
 * `review` is frontend-shaped: { reviewer, reviewerId?, reviewerWallet?,
 * decision, complianceScore, comment?, commentHash?, date? }.
 */
async function mirrorReview({ metadataHash, review, receipt }) {
  const cert = await Certificate.findOne({ metadataHash }).select('_id');
  if (!cert) throw new AppError(404, 'Certificate not found for review mirror', metadataHash);

  const entry = {
    reviewer: review.reviewer,
    reviewerId: review.reviewerId || null,
    reviewerWallet: review.reviewerWallet || null,
    decision: review.decision,
    complianceScore: review.complianceScore,
    comment: review.comment || '',
    commentHash: review.commentHash || null,
    txHash: receipt ? receipt.hash : (review.txHash || null),
    date: review.date ? new Date(review.date) : new Date(),
  };

  // CONCURRENCY (H3 #9-adjacent): two officers reviewing the same document at the
  // same instant previously raced on a load-modify-save of the whole reviews[]
  // array, silently dropping one review. Now the array mutation is ATOMIC:
  //   1) replace an existing review by this reviewer (positional $set), or
  //   2) push a new one — guarded by $ne so a concurrent insert can't double-add.
  // Identity precedence: wallet > id > name (two officers sharing a display name
  // never collide). Then derived fields are recomputed with a targeted $set so a
  // concurrent push is never clobbered.
  const idField = review.reviewerWallet ? 'reviews.reviewerWallet'
    : review.reviewerId ? 'reviews.reviewerId'
      : 'reviews.reviewer';
  const idValue = review.reviewerWallet || review.reviewerId || review.reviewer;

  // Set individual positional fields (`reviews.$.field`) rather than replacing
  // the whole element — replacing `reviews.$` conflicts with Mongoose's injected
  // `reviews.$.updatedAt` timestamp path.
  const setOnUpdate = {};
  for (const [k, v] of Object.entries(entry)) setOnUpdate[`reviews.$.${k}`] = v;
  if (receipt && receipt.hash) setOnUpdate['chain.txHashReview'] = receipt.hash;

  const updated = await Certificate.updateOne(
    { _id: cert._id, [idField]: idValue },
    { $set: setOnUpdate },
  );
  if (updated.matchedCount === 0) {
    const update = { $push: { reviews: entry } };
    if (receipt && receipt.hash) update.$set = { 'chain.txHashReview': receipt.hash };
    await Certificate.updateOne({ _id: cert._id, [idField]: { $ne: idValue } }, update);
  }

  // Recompute derived status + overall score from the now-correct reviews array
  // (targeted $set only — never rewrites reviews[], so no lost update).
  const fresh = await Certificate.findById(cert._id);
  const lifecycle = fresh.chain?.certificateStatus || 'Submitted';
  const rev = latestReview(fresh.reviews);
  const complianceScore = overallComplianceScore(fresh.reviews);
  const status = composeStatus(lifecycle, rev ? rev.decision : null, { inReview: !!fresh.inReview });
  await Certificate.updateOne({ _id: cert._id }, { $set: { status, complianceScore } });
  fresh.status = status;
  fresh.complianceScore = complianceScore;

  logger.info('mirrorReview applied', { metadataHash: metadataHash.slice(0, 12), reviewerKey: String(idValue), status, score: complianceScore });
  return fresh;
}

/**
 * mirrorRevocation — after a RevokeCertificate proposal executes on-chain.
 */
async function mirrorRevocation({ metadataHash, receipt }) {
  const cert = await Certificate.findOne({ metadataHash });
  if (!cert) throw new AppError(404, 'Certificate not found for revoke mirror', metadataHash);
  cert.chain = cert.chain || {};
  cert.chain.certificateStatus = 'Revoked';
  if (receipt) cert.chain.txHashRevoke = receipt.hash;
  recomputeCertificateFields(cert);
  await cert.save();
  return cert;
}

/**
 * mirrorCompanyApproved — after whitelist_address succeeds (company -> active).
 */
async function mirrorCompanyApproved({ companyId, receipt }) {
  const company = await Company.findById(companyId);
  if (!company) throw new AppError(404, 'Company not found for whitelist mirror', String(companyId));
  company.status = 'active';
  if (receipt) company.txHashWhitelist = receipt.hash;
  await company.save();
  return company;
}

/**
 * mirrorSubAdminActivated — after add_sub_admin succeeds (sub-admin -> active).
 */
async function mirrorSubAdminActivated({ subAdminId, receipt }) {
  const sa = await SubAdmin.findById(subAdminId);
  if (!sa) throw new AppError(404, 'SubAdmin not found for add mirror', String(subAdminId));
  sa.status = 'active';
  if (receipt) sa.txHashAdd = receipt.hash;
  await sa.save();
  return sa;
}

// Registry of replayable mirror operations (keys must match models/Outbox OPS).
// Each takes a single object payload that includes `receipt`.
const MIRRORS = {
  mirrorStoredDocument,
  mirrorIssuedCertificate,
  mirrorReview,
  mirrorRevocation,
  mirrorCompanyApproved,
  mirrorSubAdminActivated,
};

/** runMirror(op, payload, receipt) — dispatch a mirror by name (used by the
 *  durable outbox path + the outbox processor on retry). Idempotent. */
async function runMirror(op, payload = {}, receipt = null) {
  const fn = MIRRORS[op];
  if (!fn) throw new AppError(500, `runMirror: unknown mirror op '${op}'`);
  return fn({ ...payload, receipt: receipt ?? payload.receipt });
}

/**
 * writeThrough — call an adapter write, durably record it, then mirror DB.
 *   adapter : the sorobanAdapter impl
 *   method  : adapter method name (e.g. 'storeDocument')
 *   args    : args array for the adapter method
 *   purpose : Web3Tx purpose
 *   mirror  : EITHER a durable descriptor { op, payload }  (RECOMMENDED — outbox
 *             backed, self-heals on crash) OR a plain async (receipt)=>{} closure
 *             (back-compat; no durability).
 *   meta    : { certificateId, proposalId, submittedByUserId, network, requestDump }
 * Returns { receipt, tx, mirrored, outbox }.
 *
 * DURABILITY: for the descriptor form, an Outbox row is persisted BEFORE the
 * mirror is attempted. On success it is marked done; on failure it stays pending
 * and the error propagates (the caller sees a truthful failure) while the outbox
 * processor retries the idempotent mirror until the DB converges — so a crash or
 * transient DB error between chain-commit and mirror never loses the write.
 */
async function writeThrough({ adapter, method, args = [], purpose, mirror = null, meta = {} }) {
  if (!adapter || typeof adapter[method] !== 'function') {
    throw new AppError(500, `writeThrough: adapter has no method '${method}'`);
  }
  const receipt = await adapter[method](...args);

  // Durable descriptor form.
  if (mirror && typeof mirror === 'object' && mirror.op) {
    let outbox = null;
    try {
      outbox = await Outbox.create({ op: mirror.op, payload: mirror.payload || {}, receipt: receipt || null, purpose, status: 'pending' });
    } catch (err) {
      // Even if we can't persist the outbox row, still record + attempt the mirror.
      logger.error('writeThrough: failed to persist outbox row (continuing)', { op: mirror.op, error: err.message });
    }
    const tx = await recordTx({ purpose, receipt, method, ...meta });
    try {
      const mirrored = await runMirror(mirror.op, mirror.payload, receipt);
      if (outbox) await Outbox.updateOne({ _id: outbox._id }, { $set: { status: 'done', mirroredAt: new Date() } });
      return { receipt, tx, mirrored, outbox };
    } catch (err) {
      // Leave the outbox row pending for the processor; surface the failure now.
      logger.error('writeThrough: inline mirror failed — left pending in outbox for retry', { op: mirror.op, error: err.message });
      if (outbox) await Outbox.updateOne({ _id: outbox._id }, { $set: { lastError: String(err.message).slice(0, 300) } });
      throw err;
    }
  }

  // Back-compat closure form (no durability).
  const tx = await recordTx({ purpose, receipt, method, ...meta });
  let mirrored = null;
  if (typeof mirror === 'function') mirrored = await mirror(receipt);
  return { receipt, tx, mirrored };
}

module.exports = {
  recordTx,
  txStatusFromReceipt,
  recomputeCertificateFields,
  mirrorStoredDocument,
  mirrorIssuedCertificate,
  mirrorReview,
  mirrorRevocation,
  mirrorCompanyApproved,
  mirrorSubAdminActivated,
  writeThrough,
  runMirror,
  MIRRORS,
};
