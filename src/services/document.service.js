// src/services/document.service.js
// ---------------------------------------------------------------------------
// Document lifecycle (P3): submit -> review -> issue -> list/detail -> verify.
// Surfaces the single Certificate collection as /documents (A1). All chain
// access goes through the sorobanAdapter; all DB mutations through the indexer
// (write-through). Enforces the gap-compensation rules at the service layer:
//   #2 review-before-issue gate (isIssuable)
//   #3 server-side 0–100 score validation
//   #4 overall compliance score (latest-wins) — via indexer.recomputeCertificateFields
//   #6 one review per officer — via indexer.mirrorReview overwrite
// Files are RE-HASHED server-side here before anchoring (never trust a client hash).
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const fs = require('fs');
const Certificate = require('../models/Certificate');
const Company = require('../models/Company');
const SubAdmin = require('../models/SubAdmin');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { getAdapter, reviewDecisionToContract } = require('./sorobanAdapter');
const indexer = require('./indexer.service');
const { isIssuable, latestReview } = require('../utils/composeStatus');
const { REVIEW_DECISIONS, DOC_STATUSES } = require('../utils/statusMap');
const { decryptSecret } = require('../utils/wallet');
const { toDocItem } = require('../utils/serializers');
const { isCompany } = require('../utils/roles');
const { notify } = require('../utils/notify');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Serialize a saved cert to a DocItem, attaching the company name without a
// second populate round-trip.
function asDocItem(cert, companyName = null) {
  const obj = typeof cert.toObject === 'function' ? cert.toObject() : cert;
  if (companyName) obj.companyName = companyName;
  return toDocItem(obj);
}

/**
 * submitDocument — re-hash the uploaded file, anchor via store_document, mirror.
 * The company must be approved (active / whitelisted) to anchor.
 */
async function submitDocument({ buffer, filename, subject, mimeType = null, size = null, companyId, requestedByUserId, adapter = getAdapter() }) {
  if (!buffer || !buffer.length) throw new AppError(400, 'File is required');
  if (!filename || !subject) throw new AppError(400, 'filename and subject are required');
  if (!companyId) throw new AppError(400, 'companyId is required');

  const company = await Company.findById(companyId).select('+walletSecretEnc');
  if (!company) throw new AppError(404, 'Company not found');
  if (company.status !== 'active') {
    throw new AppError(403, 'Company must be approved (whitelisted) before submitting documents');
  }
  if (!company.walletAddress) throw new AppError(409, 'Company has no wallet address');

  // RE-HASH server-side — the source of truth for the on-chain anchor.
  const metadataHash = sha256(buffer);

  if (await Certificate.findOne({ metadataHash })) {
    throw new AppError(409, 'A document with the same content hash already exists');
  }

  const signerSecret = decryptSecret(company.walletSecretEnc);
  const { mirrored } = await indexer.writeThrough({
    adapter,
    method: 'storeDocument',
    args: [company.walletAddress, filename, metadataHash, { signerSecret }],
    purpose: 'store',
    meta: { submittedByUserId: requestedByUserId },
    mirror: (receipt) => indexer.mirrorStoredDocument({
      metadataHash, certificateName: filename, subject, companyId, requestedByUserId, receipt,
      network: company?.metadata?.network || 'testnet',
    }),
  });

  // Persist file metadata the mirror doesn't carry.
  mirrored.originalFilename = filename;
  if (mimeType) mirrored.mimeType = mimeType;
  if (size != null) mirrored.size = size;
  await mirrored.save();

  logger.info('Document submitted', { id: mirrored._id, hashShort: metadataHash.slice(0, 12), companyId: String(companyId) });
  return asDocItem(mirrored, company.name);
}

/** listDocuments — role-scoped + paginated list of DocItems. */
async function listDocuments({ user, page = 1, limit = 20, status = null }) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const filter = {};
  // Company admins only see their own company's documents.
  if (isCompany(user.role)) {
    if (!user.companyId) return { items: [], total: 0, page, limit };
    filter.companyId = user.companyId;
  }
  // Only accept a known string status (audit #8: reject injected objects).
  if (typeof status === 'string' && DOC_STATUSES.includes(status)) filter.status = status;

  const [docs, total] = await Promise.all([
    Certificate.find(filter)
      .populate('companyId', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Certificate.countDocuments(filter),
  ]);

  return { items: docs.map((d) => toDocItem(d)), total, page, limit };
}

/** getDocument — single DocItem, role-scoped. */
async function getDocument({ id, user }) {
  const cert = await Certificate.findById(id).populate('companyId', 'name');
  if (!cert) throw new AppError(404, 'Document not found');
  if (isCompany(user.role) && String(cert.companyId?._id || cert.companyId) !== String(user.companyId)) {
    throw new AppError(403, 'Forbidden: document belongs to another company');
  }
  return toDocItem(cert);
}

// Resolve the acting reviewer's SubAdmin profile (with custodial secret).
async function resolveReviewer(userId) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(401, 'Reviewer account not found');
  let sa = null;
  if (user.subAdminId) sa = await SubAdmin.findById(user.subAdminId).select('+walletSecretEnc');
  if (!sa && user.walletAddress) sa = await SubAdmin.findOne({ walletAddress: user.walletAddress }).select('+walletSecretEnc');
  if (!sa) throw new AppError(400, 'Reviewer is not a registered sub-admin');
  if (sa.status !== 'active') throw new AppError(409, 'Sub-admin is not yet activated on-chain');
  return sa;
}

/**
 * reviewDocument — validate score (gap #3), anchor submit_review, mirror review
 * (one-per-officer = gap #6), recompute overall score (gap #4) + status.
 */
async function reviewDocument({ id, reviewerUserId, decision, complianceScore, comment = '', adapter = getAdapter() }) {
  if (!REVIEW_DECISIONS.includes(decision)) {
    throw new AppError(400, `decision must be one of: ${REVIEW_DECISIONS.join(', ')}`);
  }
  // Reject missing/blank explicitly — Number(null) and Number('') are 0, which
  // would otherwise slip through the range check as a valid score.
  if (complianceScore === null || complianceScore === undefined || complianceScore === '') {
    throw new AppError(400, 'complianceScore is required (0–100)');
  }
  const score = Number(complianceScore);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new AppError(400, 'complianceScore must be a number between 0 and 100');
  }

  const cert = await Certificate.findById(id).populate('companyId', 'name');
  if (!cert) throw new AppError(404, 'Document not found');
  if (['issued', 'revoked', 'expired'].includes(cert.status)) {
    throw new AppError(409, `Cannot review a document that is ${cert.status}`);
  }

  const sa = await resolveReviewer(reviewerUserId);
  const hadPriorReview = cert.reviews.some((r) => r.reviewerWallet === sa.walletAddress);

  const commentHash = sha256(Buffer.from(comment || '', 'utf8'));
  const contractStatus = reviewDecisionToContract(decision); // e.g. 'ApprovedWithRecommendations'
  const signerSecret = decryptSecret(sa.walletSecretEnc);

  const { mirrored } = await indexer.writeThrough({
    adapter,
    method: 'submitReview',
    args: [sa.walletAddress, cert.metadataHash, contractStatus, score, commentHash, { signerSecret }],
    purpose: 'review',
    meta: { certificateId: cert._id, submittedByUserId: reviewerUserId },
    mirror: (receipt) => indexer.mirrorReview({
      metadataHash: cert.metadataHash,
      review: {
        reviewer: sa.name, reviewerId: sa._id, reviewerWallet: sa.walletAddress,
        decision, complianceScore: score, comment, commentHash,
      },
      receipt,
    }),
  });

  // Count a NEW review (not a re-review) toward the officer's tally.
  if (!hadPriorReview) {
    sa.reviewsDone = (sa.reviewsDone || 0) + 1;
    await sa.save();
  }

  if (cert.requestedByUserId) {
    await notify({
      userId: cert.requestedByUserId, type: 'review', title: 'Document reviewed',
      message: `Your document "${cert.certificateName}" was reviewed: ${decision} (score ${score}).`,
      entityType: 'document', entityId: String(cert._id),
    });
  }
  logger.info('Document reviewed', { id: cert._id, decision, score, reviewer: sa.name, status: mirrored.status });
  return asDocItem(mirrored, cert.companyId?.name);
}

/**
 * issueDocument — enforce the review-before-issue gate (gap #2), then anchor
 * issue_certificate (main-admin custodial) and mirror.
 */
async function issueDocument({ id, issuerUserId, expiryAt = null, adapter = getAdapter() }) {
  const cert = await Certificate.findById(id).populate('companyId', 'name');
  if (!cert) throw new AppError(404, 'Document not found');

  if (cert.chain?.certificateStatus === 'Issued' || cert.status === 'issued') {
    throw new AppError(409, 'Document already issued');
  }
  if (cert.chain?.certificateStatus && cert.chain.certificateStatus !== 'Submitted') {
    throw new AppError(409, `Document cannot be issued from status ${cert.chain.certificateStatus}`);
  }

  // GAP #2: only Approved / ApprovedWithRecommendations may be issued.
  const review = latestReview(cert.reviews);
  if (!isIssuable(review && review.decision)) {
    throw new AppError(409, 'Document cannot be issued: latest review must be Approved or ApprovedWithRecommendations');
  }

  // Default validity: +1 year (matches frontend issueCertificate).
  const expiryDate = expiryAt ? new Date(expiryAt) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(expiryDate.getTime()) || expiryDate <= new Date()) {
    throw new AppError(400, 'expiryAt must be a valid future date');
  }
  const expiryUnix = Math.floor(expiryDate.getTime() / 1000);

  const mainAdmin = await adapter.mainAdminAddress();
  const { mirrored } = await indexer.writeThrough({
    adapter,
    method: 'issueCertificate',
    args: [mainAdmin, cert.metadataHash, expiryUnix, {}],
    purpose: 'issue',
    meta: { certificateId: cert._id, submittedByUserId: issuerUserId },
    mirror: (receipt) => indexer.mirrorIssuedCertificate({ metadataHash: cert.metadataHash, expiryUnix, receipt }),
  });

  if (cert.requestedByUserId) {
    await notify({
      userId: cert.requestedByUserId, type: 'success', title: 'Certificate issued',
      message: `Your document "${cert.certificateName}" has been issued and is now verifiable.`,
      entityType: 'document', entityId: String(cert._id),
    });
  }
  logger.info('Document issued', { id: cert._id, expiryAt: expiryDate.toISOString() });
  return asDocItem(mirrored, cert.companyId?.name);
}

/**
 * verifyDocument — PUBLIC. Reads the chain (verify_document) for the effective
 * status and returns it alongside the DB record (if present).
 */
async function verifyDocument({ hashOrId, adapter = getAdapter() }) {
  let hash = hashOrId;
  let cert = null;
  if (!/^[a-f0-9]{64}$/i.test(String(hashOrId))) {
    cert = await Certificate.findById(hashOrId).populate('companyId', 'name').catch(() => null);
    if (!cert) throw new AppError(404, 'Document not found');
    hash = cert.metadataHash;
  } else {
    cert = await Certificate.findOne({ metadataHash: hash }).populate('companyId', 'name');
  }

  const chainDoc = await adapter.verifyDocument(hash);
  return {
    verified: !!(chainDoc && chainDoc.verified_document),
    hash,
    certificateStatus: chainDoc ? chainDoc.certificate_status : null,
    onChain: !!chainDoc,
    expiry: chainDoc && chainDoc.expiry ? Number(chainDoc.expiry) : null,
    document: cert ? toDocItem(cert) : null,
  };
}

/**
 * getDocumentFile — resolve the stored upload for download (role-scoped). Only
 * available in disk-storage mode (memory-mode uploads keep no file).
 */
async function getDocumentFile({ id, user }) {
  const cert = await Certificate.findById(id);
  if (!cert) throw new AppError(404, 'Document not found');
  if (isCompany(user.role) && String(cert.companyId) !== String(user.companyId)) {
    throw new AppError(403, 'Forbidden: document belongs to another company');
  }
  if (!cert.storage?.path || !fs.existsSync(cert.storage.path)) {
    throw new AppError(404, 'No stored file available for this document');
  }
  return { path: cert.storage.path, filename: cert.originalFilename || `${cert._id}`, mimeType: cert.mimeType || 'application/octet-stream' };
}

module.exports = {
  submitDocument,
  listDocuments,
  getDocument,
  reviewDocument,
  issueDocument,
  verifyDocument,
  getDocumentFile,
};
