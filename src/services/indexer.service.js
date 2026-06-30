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
  const cert = await Certificate.findOne({ metadataHash });
  if (!cert) throw new AppError(404, 'Certificate not found for review mirror', metadataHash);

  const key = review.reviewerWallet || review.reviewer || (review.reviewerId && String(review.reviewerId));
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

  // Replace an existing review by the same reviewer; else append. Match on the
  // strongest available identity FIRST — wallet, then id, then (last resort)
  // display name — so two officers who share a display name don't collide.
  const idx = cert.reviews.findIndex((r) => {
    if (review.reviewerWallet && r.reviewerWallet) return r.reviewerWallet === review.reviewerWallet;
    if (review.reviewerId && r.reviewerId) return String(r.reviewerId) === String(review.reviewerId);
    return !!(r.reviewer && review.reviewer && r.reviewer === review.reviewer);
  });
  if (idx >= 0) cert.reviews[idx] = entry;
  else cert.reviews.push(entry);

  cert.chain = cert.chain || {};
  if (receipt) cert.chain.txHashReview = receipt.hash;
  recomputeCertificateFields(cert);
  await cert.save();
  logger.info('mirrorReview applied', { metadataHash: metadataHash.slice(0, 12), reviewerKey: key, status: cert.status, score: cert.complianceScore });
  return cert;
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

/**
 * writeThrough — call an adapter write, persist the Web3Tx, then mirror DB.
 *   adapter : the sorobanAdapter impl
 *   method  : adapter method name (e.g. 'storeDocument')
 *   args    : args array for the adapter method
 *   purpose : Web3Tx purpose
 *   mirror  : optional async (receipt) => {} that projects state onto the DB
 *   meta    : { certificateId, proposalId, submittedByUserId, network, requestDump }
 * Returns { receipt, tx, mirrored }.
 */
async function writeThrough({ adapter, method, args = [], purpose, mirror = null, meta = {} }) {
  if (!adapter || typeof adapter[method] !== 'function') {
    throw new AppError(500, `writeThrough: adapter has no method '${method}'`);
  }
  const receipt = await adapter[method](...args);
  const tx = await recordTx({ purpose, receipt, method, ...meta });
  let mirrored = null;
  if (mirror) mirrored = await mirror(receipt);
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
};
