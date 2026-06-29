
// models/Certificate.js  (update — keep the rest of your schema)
const mongoose = require('mongoose');

const certSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: false },
  certificateName: { type: String, required: true },
  subject: { type: String, required: true },

  metadataHash: { type: String, required: true }, // e.g., sha256
  // file metadata
  originalFilename: { type: String },
  mimeType: { type: String },
  size: { type: Number },

  // local storage info
  storage: {
    provider: { type: String, enum: ['local','s3','minio','gridfs'], default: 'local' },
    path: { type: String },     // absolute path on disk (never client-controlled)
    publicUrl: { type: String } // e.g., https://yourdomain.com/certificates/<filename>
  },

  certificateUrl: { type: String , required: false}, // backward compat
  status: { type: String, enum: ['requested', 'issued', 'validated', 'revoked', 'expired'], default: 'requested', index: true },
  chain: {
      network: { type: String, enum: ['testnet', 'mainnet'], default: 'testnet' },
      contractId: { type: String },
      onChainId: { type: String },
      txHashIssue: { type: String },
      txHashValidate: { type: String }
    },  expiryAt: { type: Date }
}, { timestamps: true });

certSchema.index({ companyId: 1, status: 1 });
module.exports = mongoose.model('Certificate', certSchema);
