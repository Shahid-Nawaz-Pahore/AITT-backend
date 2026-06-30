// src/utils/composeStatus.js
// ---------------------------------------------------------------------------
// Compose the frontend 9-value `DocStatus` from the deployed contract's
// CertificateStatus (lifecycle) + the document's latest review decision.
//
// The deployed contract does NOT roll these up — it stores the lifecycle
// (Submitted/Issued/Revoked/Expired) on Document.status and each reviewer's
// outcome separately. The backend composes them (build brief gap #6) and also:
//   - decides issuability (gap #2): only Approved / ApprovedWithRecommendations
//   - rolls up the overall compliance score (gap #4): latest review wins (A6)
//
// Composition rules (lifecycle wins for terminal states):
//   Revoked                       -> 'revoked'
//   Expired                       -> 'expired'
//   Issued                        -> 'issued'
//   Submitted + no review         -> 'submitted'
//   Submitted + 'in review' flag  -> 'under_review'
//   Submitted + latest decision   -> approved | approved_with_recommendations
//                                    | requires_changes | rejected
// ---------------------------------------------------------------------------
const {
  DOC_STATUS,
  CERT_STATUS,
  CERT_STATUS_TO_DOC,
  DECISION_TO_DOC,
  contractToDecision,
} = require('./statusMap');

// Decisions that allow a certificate to be issued (gap #2).
const ISSUABLE_DECISIONS = Object.freeze(['approved', 'approved_with_recommendations']);

// Normalize a lifecycle value to a contract CertificateStatus enum name.
// Accepts: 'Submitted'/'Issued'/... (contract enum), lowercase variants, or a
// VerifiedDocument-style object { certificate_status } / Document { status }.
function normalizeLifecycle(lifecycle) {
  if (!lifecycle) return CERT_STATUS.SUBMITTED;
  if (typeof lifecycle === 'object') {
    return normalizeLifecycle(lifecycle.certificate_status || lifecycle.status);
  }
  const s = String(lifecycle).toLowerCase();
  switch (s) {
    case 'submitted': return CERT_STATUS.SUBMITTED;
    case 'issued': return CERT_STATUS.ISSUED;
    case 'revoked': return CERT_STATUS.REVOKED;
    case 'expired': return CERT_STATUS.EXPIRED;
    default: return CERT_STATUS.SUBMITTED;
  }
}

// Normalize a review decision to a frontend ReviewDecision string.
// Accepts a ReviewDecision ('approved'...), a contract DocumentStatus name
// ('Approved'...), or a review-like object { decision } / { status }.
function normalizeDecision(decision) {
  if (!decision) return null;
  if (typeof decision === 'object') {
    return normalizeDecision(decision.decision || decision.status);
  }
  const raw = String(decision);
  if (DECISION_TO_DOC[raw.toLowerCase()]) return raw.toLowerCase();
  const fromContract = contractToDecision(raw);
  return fromContract || null;
}

/**
 * latestReview(reviews) — the most recent review by date/createdAt (A6:
 * latest wins). Returns null for empty/invalid input.
 */
function latestReview(reviews) {
  if (!Array.isArray(reviews) || reviews.length === 0) return null;
  return reviews.reduce((latest, r) => {
    const t = new Date(r.date || r.createdAt || 0).getTime();
    const lt = latest ? new Date(latest.date || latest.createdAt || 0).getTime() : -Infinity;
    return t >= lt ? r : latest;
  }, null);
}

/**
 * composeStatus(lifecycle, latestDecision, opts?) -> DocStatus (one of 9).
 *  - lifecycle: contract CertificateStatus (enum name / lowercase / object)
 *  - latestDecision: latest ReviewDecision (or contract DocumentStatus / object)
 *  - opts.inReview: true to surface 'under_review' when Submitted + no decision
 */
function composeStatus(lifecycle, latestDecision, opts = {}) {
  const life = normalizeLifecycle(lifecycle);

  // Terminal lifecycle states win outright.
  if (life === CERT_STATUS.REVOKED) return DOC_STATUS.REVOKED;
  if (life === CERT_STATUS.EXPIRED) return DOC_STATUS.EXPIRED;
  if (life === CERT_STATUS.ISSUED) return DOC_STATUS.ISSUED;

  // Submitted: composed with the latest review decision (if any).
  const decision = normalizeDecision(latestDecision);
  if (decision && DECISION_TO_DOC[decision]) return DECISION_TO_DOC[decision];

  if (opts.inReview) return DOC_STATUS.UNDER_REVIEW;
  return CERT_STATUS_TO_DOC[life] || DOC_STATUS.SUBMITTED;
}

/**
 * composeFromCertificate(cert) -> DocStatus, computed from a Certificate doc.
 * Uses cert.chain lifecycle when available, otherwise the stored cert.status,
 * composed with the latest embedded review.
 */
function composeFromCertificate(cert) {
  if (!cert) return DOC_STATUS.SUBMITTED;
  const lifecycle =
    cert.chain?.certificateStatus ||
    cert.lifecycleStatus ||
    cert.status; // stored status may already be a lifecycle-ish value
  const review = latestReview(cert.reviews);
  return composeStatus(lifecycle, review ? review.decision : null, {
    inReview: !!cert.inReview,
  });
}

/**
 * isIssuable(latestDecision) — gap #2: a certificate may only be issued when the
 * latest review is Approved or ApprovedWithRecommendations.
 */
function isIssuable(latestDecision) {
  const decision = normalizeDecision(latestDecision);
  return ISSUABLE_DECISIONS.includes(decision);
}

/** isIssuableCertificate(cert) — convenience over the latest embedded review. */
function isIssuableCertificate(cert) {
  const review = latestReview(cert && cert.reviews);
  return review ? isIssuable(review.decision) : false;
}

/**
 * overallComplianceScore(reviews) — gap #4: the backend rolls up the overall
 * 0–100 score. Per A6 the latest review wins. Returns null when no reviews.
 */
function overallComplianceScore(reviews) {
  const review = latestReview(reviews);
  if (!review) return null;
  const score = Number(review.complianceScore);
  return Number.isFinite(score) ? score : null;
}

module.exports = {
  composeStatus,
  composeFromCertificate,
  isIssuable,
  isIssuableCertificate,
  latestReview,
  overallComplianceScore,
  normalizeLifecycle,
  normalizeDecision,
  ISSUABLE_DECISIONS,
};
