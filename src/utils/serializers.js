// src/utils/serializers.js
// ---------------------------------------------------------------------------
// Map backend Mongoose models -> the EXACT frontend shapes in
// frontend-aitt/src/mock/types.ts. All list/detail responses go through these
// so the API stays drop-in compatible with the approved frontend.
// ---------------------------------------------------------------------------

function iso(d) {
  if (!d) return undefined;
  return new Date(d).toISOString();
}

/** Embedded review -> frontend `Review`. */
function toReview(r) {
  if (!r) return null;
  return {
    reviewer: r.reviewer || null,
    decision: r.decision,
    complianceScore: r.complianceScore,
    comment: r.comment || '',
    date: iso(r.date || r.createdAt) || new Date(0).toISOString(),
    commentHash: r.commentHash || '',
    ...(r.txHash ? { txHash: r.txHash } : {}),
  };
}

/** Certificate -> frontend `DocItem`. companyId may be populated ({name}) or raw. */
function toDocItem(cert) {
  if (!cert) return null;
  const c = typeof cert.toObject === 'function' ? cert.toObject() : cert;
  const companyName =
    (c.companyId && typeof c.companyId === 'object' && c.companyId.name) ||
    c.companyName ||
    null;
  const txHash = c.chain?.txHashIssue || c.chain?.txHashStore || c.txHash || undefined;
  // Latest review decision, surfaced top-level so it survives the public
  // registry's reviews[] stripping (the client's "Review status" field).
  const revs = Array.isArray(c.reviews) ? c.reviews : [];
  const latestRev = revs.length
    ? revs.reduce((a, b) => (new Date(b.date || 0) > new Date(a.date || 0) ? b : a))
    : null;

  return {
    id: String(c._id),
    filename: c.originalFilename || c.certificateName || null,
    company: companyName,
    subject: c.subject || null,
    status: c.status,
    submittedAt: iso(c.createdAt) || new Date(0).toISOString(),
    ...(c.expiryAt ? { expiryAt: iso(c.expiryAt) } : {}),
    hash: c.metadataHash,
    ...(txHash ? { txHash } : {}),
    ...(c.complianceScore != null ? { complianceScore: c.complianceScore } : {}),
    ...(c.jurisdiction ? { jurisdiction: c.jurisdiction } : {}),
    ...(c.programName ? { program: c.programName } : {}),
    ...(c.programType ? { programType: c.programType } : {}),
    ...(c.programId ? { programId: String(c.programId._id || c.programId) } : {}),
    ...(latestRev ? { reviewStatus: latestRev.decision } : {}),
    reviews: Array.isArray(c.reviews) ? c.reviews.map(toReview) : [],
  };
}

/** Company -> frontend `Company`. docCount optional (else uses company.documents). */
function toCompany(company, docCount = null) {
  if (!company) return null;
  const c = typeof company.toObject === 'function' ? company.toObject() : company;
  return {
    id: String(c._id),
    name: c.name,
    email: c.contactEmail || null,
    wallet: c.walletAddress || null,
    status: c.status || 'pending',
    documents: docCount != null ? docCount : (c.documents || 0),
    joinedAt: iso(c.createdAt) || new Date(0).toISOString(),
  };
}

/** SubAdmin -> frontend `SubAdmin`. */
function toSubAdmin(sa) {
  if (!sa) return null;
  const s = typeof sa.toObject === 'function' ? sa.toObject() : sa;
  return {
    id: String(s._id),
    name: s.name,
    email: s.email || null,
    wallet: s.walletAddress || null,
    reviewsDone: s.reviewsDone || 0,
    status: s.status || 'invited',
  };
}

/** Proposal -> frontend `Proposal`. approvals is derived from signers.length. */
function toProposal(p) {
  if (!p) return null;
  const o = typeof p.toObject === 'function' ? p.toObject() : p;
  const signers = Array.isArray(o.signers) ? o.signers : [];
  return {
    id: String(o._id),
    type: o.type,
    title: o.title,
    description: o.description || '',
    status: o.status || 'pending',
    approvals: signers.length, // gap #5: count derived from the signer list
    threshold: o.threshold,
    signers,
    createdBy: o.createdBy || null,
    createdAt: iso(o.createdAt) || new Date(0).toISOString(),
    ...(o.targetRef ? { targetRef: o.targetRef } : {}),
  };
}

/** Framework -> frontend `Framework`. */
function toFramework(f) {
  if (!f) return null;
  const o = typeof f.toObject === 'function' ? f.toObject() : f;
  return { id: String(o._id), name: o.name, description: o.description || '' };
}

/** Standard paginated list envelope. */
function paginate(items, { page, limit, total }) {
  return {
    data: items,
    pagination: {
      currentPage: Number(page),
      totalPages: Math.max(1, Math.ceil(total / limit)),
      total,
      limit: Number(limit),
    },
  };
}

module.exports = { toReview, toDocItem, toCompany, toSubAdmin, toProposal, toFramework, paginate, iso };
