// src/models/GovernanceConfig.js
// ---------------------------------------------------------------------------
// Singleton configurable N-of-M multi-signature threshold.
// Mirrors frontend-aitt/src/mock/types.ts -> `GovernanceConfig`
// (required = N, total = M).
//
// `required` (N) is mirrored on-chain as the contract's GovernanceThreshold;
// `total` (M) is the number of eligible signers (sub-admins) and is backend-only.
// Constraint (per brief): N must be <= M.
// ---------------------------------------------------------------------------
const mongoose = require('mongoose');

const governanceConfigSchema = new mongoose.Schema({
  // Discriminator so only one config document exists (singleton).
  key: { type: String, default: 'global', unique: true, immutable: true },

  required: { type: Number, default: 1, min: 1 }, // N — on-chain governance_threshold
  total: { type: Number, default: 1, min: 1 },    // M — eligible signer count

  // Last time the on-chain threshold was synced from this config.
  lastSyncedThreshold: { type: Number, default: null },
  txHashThreshold: { type: String, default: null },
}, { timestamps: true });

governanceConfigSchema.pre('validate', function enforceNLeqM(next) {
  if (this.required > this.total) {
    return next(new Error('Governance threshold (required N) cannot exceed total signers (M)'));
  }
  next();
});

// Fetch-or-create the singleton config.
governanceConfigSchema.statics.getSingleton = async function getSingleton() {
  let cfg = await this.findOne({ key: 'global' });
  if (!cfg) cfg = await this.create({ key: 'global' });
  return cfg;
};

module.exports = mongoose.model('GovernanceConfig', governanceConfigSchema);
