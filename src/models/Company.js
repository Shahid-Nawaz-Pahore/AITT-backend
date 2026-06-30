const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  name: { type: String, required: true },
  contactEmail: { type: String },
  contactPhone: { type: String },
  walletAddress: { type: String },
  // Custodial secret for the company wallet, ENCRYPTED at rest (utils/wallet.js).
  // Never serialized to clients. Used as the `actor` for store_document.
  walletSecretEnc: { type: String, default: null, select: false },
  // Lifecycle (frontend `Company.status`): new companies register as 'pending'
  // and become 'active' once approved (-> on-chain whitelist_address in P3).
  // The P1 migration backfills existing companies to 'active'.
  status: { type: String, enum: ['pending', 'active'], default: 'pending', index: true },
  // Chain anchor for the whitelist_address tx (set on approval).
  txHashWhitelist: { type: String, default: null },
  metadata: { type: Object }
}, { timestamps: true });

companySchema.index({ name: 'text', contactEmail: 1 });
module.exports = mongoose.model('Company', companySchema);
