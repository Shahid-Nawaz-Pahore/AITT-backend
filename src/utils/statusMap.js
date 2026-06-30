// src/utils/statusMap.js
// ---------------------------------------------------------------------------
// Cross-vocabulary status maps. Single source of truth for translating between:
//   - the deployed contract enums (CertificateStatus lifecycle + DocumentStatus
//     review outcome) — see stellar_document_verification_system/.../lib.rs
//   - the frontend `DocStatus` (9 values) + `ReviewDecision` (4 values)
//     — see frontend-aitt/src/mock/types.ts
//   - the LEGACY backend Certificate.status (pre-P1: 5 values)
//
// `composeStatus.js` consumes these maps to compute the composed 9-status.
// Migrations consume LEGACY_STATUS_TO_DOC to rewrite old records.
// ---------------------------------------------------------------------------

// --- Frontend DocStatus (9) — the composed certificate/document status ---
const DOC_STATUS = Object.freeze({
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  REQUIRES_CHANGES: 'requires_changes',
  APPROVED: 'approved',
  APPROVED_WITH_RECOMMENDATIONS: 'approved_with_recommendations',
  ISSUED: 'issued',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
});
const DOC_STATUSES = Object.freeze(Object.values(DOC_STATUS));

// --- Frontend ReviewDecision (4) — a single reviewer's outcome ---
const REVIEW_DECISION = Object.freeze({
  APPROVED: 'approved',
  APPROVED_WITH_RECOMMENDATIONS: 'approved_with_recommendations',
  REQUIRES_CHANGES: 'requires_changes',
  REJECTED: 'rejected',
});
const REVIEW_DECISIONS = Object.freeze(Object.values(REVIEW_DECISION));

// --- On-chain CertificateStatus (lifecycle, on Document.status) ---
const CERT_STATUS = Object.freeze({
  SUBMITTED: 'Submitted',
  ISSUED: 'Issued',
  REVOKED: 'Revoked',
  EXPIRED: 'Expired',
});

// --- On-chain DocumentStatus (review outcome enum names) ---
const CONTRACT_DOCUMENT_STATUS = Object.freeze({
  APPROVED: 'Approved',
  APPROVED_WITH_RECOMMENDATIONS: 'ApprovedWithRecommendations',
  REQUIRES_CHANGES: 'RequiresChanges',
  REJECTED: 'Rejected',
});

// frontend ReviewDecision  <->  contract DocumentStatus enum name
const DECISION_TO_CONTRACT = Object.freeze({
  approved: 'Approved',
  approved_with_recommendations: 'ApprovedWithRecommendations',
  requires_changes: 'RequiresChanges',
  rejected: 'Rejected',
});
const CONTRACT_TO_DECISION = Object.freeze({
  Approved: 'approved',
  ApprovedWithRecommendations: 'approved_with_recommendations',
  RequiresChanges: 'requires_changes',
  Rejected: 'rejected',
});

// on-chain CertificateStatus  ->  base frontend DocStatus (when there is no
// review to compose with, e.g. lifecycle states win outright).
const CERT_STATUS_TO_DOC = Object.freeze({
  Submitted: 'submitted',
  Issued: 'issued',
  Revoked: 'revoked',
  Expired: 'expired',
});

// frontend ReviewDecision -> the DocStatus it produces while still Submitted.
// (Matches the frontend store's `decisionToStatus` map.)
const DECISION_TO_DOC = Object.freeze({
  approved: 'approved',
  approved_with_recommendations: 'approved_with_recommendations',
  requires_changes: 'requires_changes',
  rejected: 'rejected',
});

// LEGACY backend Certificate.status (pre-P1) -> new DocStatus.
// Note: legacy `validated` came AFTER issuance in the old flow, so it maps to
// `issued` (the on-chain lifecycle has no separate "validated" state).
const LEGACY_STATUS_TO_DOC = Object.freeze({
  requested: 'submitted',
  issued: 'issued',
  validated: 'issued',
  revoked: 'revoked',
  expired: 'expired',
});
const LEGACY_STATUSES = Object.freeze(Object.keys(LEGACY_STATUS_TO_DOC));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** frontend ReviewDecision -> contract DocumentStatus enum name (or null). */
function decisionToContract(decision) {
  if (!decision) return null;
  return DECISION_TO_CONTRACT[String(decision).toLowerCase()] || null;
}

/** contract DocumentStatus enum name -> frontend ReviewDecision (or null). */
function contractToDecision(status) {
  if (!status) return null;
  return CONTRACT_TO_DECISION[String(status)] || null;
}

/** Map a legacy 5-value Certificate.status to the new 9-value DocStatus. */
function mapLegacyStatus(legacy) {
  if (!legacy) return null;
  return LEGACY_STATUS_TO_DOC[String(legacy).toLowerCase()] || null;
}

/** True when `s` is one of the 9 valid composed DocStatus values. */
function isDocStatus(s) {
  return DOC_STATUSES.includes(s);
}

/** True when `s` is one of the 4 valid ReviewDecision values. */
function isReviewDecision(s) {
  return REVIEW_DECISIONS.includes(s);
}

module.exports = {
  DOC_STATUS,
  DOC_STATUSES,
  REVIEW_DECISION,
  REVIEW_DECISIONS,
  CERT_STATUS,
  CONTRACT_DOCUMENT_STATUS,
  DECISION_TO_CONTRACT,
  CONTRACT_TO_DECISION,
  CERT_STATUS_TO_DOC,
  DECISION_TO_DOC,
  LEGACY_STATUS_TO_DOC,
  LEGACY_STATUSES,
  decisionToContract,
  contractToDecision,
  mapLegacyStatus,
  isDocStatus,
  isReviewDecision,
};
