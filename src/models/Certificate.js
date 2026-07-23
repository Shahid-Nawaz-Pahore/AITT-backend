// models/Certificate.js
// ---------------------------------------------------------------------------
// The compliance document / certificate. Exposed to the frontend as a
// `DocItem` (frontend-aitt/src/mock/types.ts) in P3. P1 extends the schema to:
//   - the composed 9-value status (DocStatus)
//   - an overall complianceScore (0–100, rolled up from reviews — gap #4)
//   - embedded reviews[] (one per sub-admin; latest wins — A6 / gap #6)
//   - chain txHash anchors for each lifecycle step (store/issue/review/revoke)
//   - a UNIQUE metadataHash (mirrors the contract's "Document already registered")
// ---------------------------------------------------------------------------
const mongoose = require('mongoose');
const { DOC_STATUSES, REVIEW_DECISIONS } = require('../utils/statusMap');

// Embedded review — mirrors frontend `Review` (reviewer, decision,
// complianceScore, comment, date, commentHash, txHash) + backend links.
const reviewSchema = new mongoose.Schema({
  reviewer: { type: String },                         // sub-admin display name (frontend)
  reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubAdmin', default: null },
  reviewerWallet: { type: String, default: null },    // on-chain Address of the reviewer
  decision: { type: String, enum: REVIEW_DECISIONS, required: true },
  complianceScore: { type: Number, min: 0, max: 100, required: true }, // 0–100 (gap #3)
  comment: { type: String, default: '' },
  commentHash: { type: String, default: null },       // SHA-256 of the comment (anchored)
  txHash: { type: String, default: null },            // submit_review tx anchor
  date: { type: Date, default: Date.now },
}, { _id: false, timestamps: true });

const certSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: false },
  certificateName: { type: String, required: true },
  subject: { type: String, required: true },

  // Compliance program + jurisdiction (EU/US). programName/programType are
  // snapshotted at submit time so the certificate keeps its label even if the
  // program is later renamed or archived.
  programId: { type: mongoose.Schema.Types.ObjectId, ref: 'ComplianceProgram', default: null, index: true },
  programName: { type: String, default: null },
  programType: { type: String, default: null },
  jurisdiction: { type: String, enum: ['EU', 'US', null], default: null, index: true },

  metadataHash: { type: String, required: true, unique: true }, // sha256; UNIQUE (gap-compensation)
  // file metadata
  originalFilename: { type: String },
  mimeType: { type: String },
  size: { type: Number },

  // File storage descriptor (H4 #11 — pluggable via services/storage.service).
  storage: {
    provider: { type: String, enum: ['local', 's3', 'minio', 'gridfs', 'memory'], default: 'local' },
    key: { type: String },      // driver-specific id (GridFS ObjectId / memory key / disk filename)
    path: { type: String },     // absolute path on disk (disk driver only; never client-controlled)
    publicUrl: { type: String } // e.g., https://yourdomain.com/certificates/<filename>
  },

  certificateUrl: { type: String , required: false}, // backward compat

  // Composed 9-value status (frontend DocStatus). Computed via
  // utils/composeStatus from the on-chain lifecycle + the latest review.
  status: { type: String, enum: DOC_STATUSES, default: 'submitted', index: true },

  // Overall compliance score (0–100), rolled up from reviews (latest wins).
  complianceScore: { type: Number, min: 0, max: 100, default: null },

  // Per-reviewer reviews (one per sub-admin; latest replaces prior — gap #6).
  reviews: { type: [reviewSchema], default: [] },

  // Who submitted/requested the document.
  requestedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  chain: {
    network: { type: String, enum: ['testnet', 'mainnet'], default: 'testnet' },
    contractId: { type: String },
    onChainId: { type: String },
    // Raw on-chain CertificateStatus lifecycle (Submitted/Issued/Revoked/Expired).
    // No default: left undefined until anchored (enum skips undefined, not null).
    certificateStatus: { type: String, enum: ['Submitted', 'Issued', 'Revoked', 'Expired'] },
    txHashStore: { type: String },   // store_document
    txHashIssue: { type: String },   // issue_certificate
    txHashReview: { type: String },  // submit_review (latest)
    txHashRevoke: { type: String },  // RevokeCertificate proposal execution
  },
  expiryAt: { type: Date }
}, { timestamps: true });

certSchema.index({ companyId: 1, status: 1 });
module.exports = mongoose.model('Certificate', certSchema);
