// src/services/sorobanAdapter/decode.js
// ---------------------------------------------------------------------------
// Return-value DECODERS for the real adapter — the symmetric mirror of the
// ENCODERS in rpc.js (enumScVal / u64ScVal / bytesN32ScVal). The deployed
// contract's #[contracttype] enums have NO integer discriminants, so the host
// serializes them as  ScVal::Vec([Symbol(variant), ...payload]) . After
// scValToNative + safeValue (see rpc.fetchValue) that surfaces in JS as:
//
//   CertificateStatus::Issued                -> ["Issued"]
//   DocumentStatus::ApprovedWithRecommendations -> ["ApprovedWithRecommendations"]
//   ProposalAction::RevokeCertificate("h")   -> ["RevokeCertificate", "h"]
//   ProposalAction::UpdateThreshold(5)        -> ["UpdateThreshold", 5]
//   ProposalAction::ContractUpgrade(bytes)    -> ["ContractUpgrade", "<hex>"]
//
// and every u64 (id / expiry / timestamp) surfaces as a decimal STRING (bigint
// stringified by safeValue), while u32 (score / threshold) is already a Number.
//
// These decoders normalize all of that back to the EXACT shapes the in-memory
// stub returns, so the indexer / composeStatus / statusMap / reconcile — all
// built and tested against the stub — are byte-for-byte transparent to which
// adapter is live. Every function is pure, idempotent (safe to re-apply to
// already-decoded values), and null-safe.
// ---------------------------------------------------------------------------

/** u64/i64 (decimal string or bigint) -> Number; preserves null/undefined. */
function toNum(x) {
  if (x === null || x === undefined) return x;
  return typeof x === 'number' ? x : Number(x);
}

/**
 * decodeContractEnum — a contract enum variant NAME from its native form.
 * Mirror of rpc.enumScVal(name) for the unit-variant (no-payload) case.
 *   ["Issued"] -> "Issued"   |   "Issued" -> "Issued" (idempotent)
 */
function decodeContractEnum(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length ? String(v[0]) : null;
  return String(v);
}

/**
 * decodeProposalAction — ProposalAction scVal -> the normalized action object
 * the rest of the backend (and the stub) use. Mirror of real.actionToScVal.
 *   ["RevokeCertificate","h"] -> { type:'RevokeCertificate', docHash:'h' }
 *   ["UpdateThreshold", 5]    -> { type:'UpdateThreshold', value:5 }
 *   ["ContractUpgrade","hex"] -> { type:'ContractUpgrade', wasmHash:'hex' }
 * Idempotent: passing an already-normalized { type, ... } returns it unchanged.
 */
function decodeProposalAction(v) {
  if (v == null) return null;
  // Already normalized (stub form / re-applied).
  if (!Array.isArray(v) && typeof v === 'object' && v.type) return v;
  const arr = Array.isArray(v) ? v : [v];
  const type = String(arr[0]);
  const payload = arr[1];
  switch (type) {
    case 'RevokeCertificate':
      return { type, docHash: payload == null ? null : String(payload) };
    case 'UpdateThreshold':
      return { type, value: toNum(payload) };
    case 'ContractUpgrade':
      return { type, wasmHash: payload == null ? null : String(payload) };
    default:
      return { type, payload: arr.slice(1) };
  }
}

/**
 * decodeDocument — Document struct -> stub-identical shape.
 * { name, hash, timestamp:Number, added_by, status:String, expiry:Number }
 */
function decodeDocument(d) {
  if (!d) return null;
  return {
    name: d.name,
    hash: d.hash,
    timestamp: toNum(d.timestamp),
    added_by: d.added_by,
    status: decodeContractEnum(d.status),
    expiry: toNum(d.expiry),
  };
}

/**
 * decodeVerifiedDocument — VerifiedDocument struct -> stub-identical shape.
 * { name, hash, timestamp, added_by, verified_document:Bool,
 *   certificate_status:String, expiry:Number }
 */
function decodeVerifiedDocument(v) {
  if (!v) return null;
  return {
    name: v.name,
    hash: v.hash,
    timestamp: toNum(v.timestamp),
    added_by: v.added_by,
    verified_document: !!v.verified_document,
    certificate_status: decodeContractEnum(v.certificate_status),
    expiry: toNum(v.expiry),
  };
}

/**
 * decodeReview — Review struct -> stub-identical shape.
 * { reviewer, status:String, score:Number, comment_hash, timestamp:Number }
 */
function decodeReview(r) {
  if (!r) return null;
  return {
    reviewer: r.reviewer,
    status: decodeContractEnum(r.status),
    score: toNum(r.score),
    comment_hash: r.comment_hash,
    timestamp: toNum(r.timestamp),
  };
}

/**
 * decodeProposal — Proposal struct -> stub-identical shape.
 * { id:Number, action:{type,...}, approvals:String[], executed:Bool }
 */
function decodeProposal(p) {
  if (!p) return null;
  return {
    id: toNum(p.id),
    action: decodeProposalAction(p.action),
    approvals: Array.isArray(p.approvals) ? p.approvals.slice() : [],
    executed: !!p.executed,
  };
}

module.exports = {
  toNum,
  decodeContractEnum,
  decodeProposalAction,
  decodeDocument,
  decodeVerifiedDocument,
  decodeReview,
  decodeProposal,
};
