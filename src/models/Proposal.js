// src/models/Proposal.js
// ---------------------------------------------------------------------------
// Multi-sig governance proposal. Mirrors frontend-aitt/src/mock/types.ts ->
// `Proposal` (id, type, title, description, status, approvals, threshold,
// signers[], createdBy, createdAt, targetRef) plus the backend metadata the
// deployed contract does NOT store.
//
// Per the build brief's gap-compensation rules:
//  - title / description / proposer / createdAt live in the DB (the contract
//    only stores action + approvals[] + executed).
//  - 3 of the 4 proposal types are ON-CHAIN (revocation -> RevokeCertificate,
//    governance_rule -> UpdateThreshold, contract_upgrade -> ContractUpgrade).
//  - `framework_update` has NO on-chain action — it is governed entirely in the
//    DB (collect approvals here, apply when approvals >= threshold).
//  - `signers[]` mirrors the on-chain `approvals` Vec<Address>; `approvals`
//    count is derived from signers.length when serialized for the frontend.
//  - `status` = executed ? 'executed' : (rejected ? 'rejected' : 'pending').
// ---------------------------------------------------------------------------
const mongoose = require('mongoose');

const PROPOSAL_TYPES = ['revocation', 'framework_update', 'governance_rule', 'contract_upgrade'];
const PROPOSAL_STATUSES = ['pending', 'executed', 'rejected'];

// Which proposal types are settled on-chain vs. backend-only (off-chain).
const ONCHAIN_PROPOSAL_TYPES = ['revocation', 'governance_rule', 'contract_upgrade'];
const OFFCHAIN_PROPOSAL_TYPES = ['framework_update'];

const proposalSchema = new mongoose.Schema({
  type: { type: String, enum: PROPOSAL_TYPES, required: true, index: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },

  status: { type: String, enum: PROPOSAL_STATUSES, default: 'pending', index: true },

  // N-of-M threshold captured at creation time (snapshot of GovernanceConfig.required).
  threshold: { type: Number, required: true, min: 1 },

  // Wallets that have approved/signed (mirrors on-chain Proposal.approvals).
  // `approvals` count is derived from signers.length in the serializer.
  signers: { type: [String], default: [] },

  // Proposer metadata (frontend `createdBy`).
  createdBy: { type: String, default: null },          // display name or wallet
  createdById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  proposerWallet: { type: String, default: null },

  // Frontend `targetRef` — meaning depends on type:
  //   revocation       -> the Certificate/document id (or metadataHash) being revoked
  //   governance_rule  -> stringified new threshold
  //   contract_upgrade -> wasm hash
  //   framework_update -> the Framework id being changed
  targetRef: { type: String, default: null },

  // Type-specific structured payload (off-chain framework_update changes,
  // proposed threshold value, target metadataHash, wasm hash, etc.).
  payload: { type: Object, default: {} },

  // On-chain proposal id (contract create_proposal -> u64). Null for off-chain
  // (framework_update) proposals.
  onChainId: { type: Number, default: null, index: true },

  // Whether this proposal is settled on-chain or purely in the backend.
  onChain: { type: Boolean, default: true },

  executed: { type: Boolean, default: false },
  executedAt: { type: Date, default: null },

  // Chain anchors.
  txHashCreate: { type: String, default: null },
  txHashExecute: { type: String, default: null },
}, { timestamps: true });

proposalSchema.statics.PROPOSAL_TYPES = PROPOSAL_TYPES;
proposalSchema.statics.PROPOSAL_STATUSES = PROPOSAL_STATUSES;
proposalSchema.statics.ONCHAIN_PROPOSAL_TYPES = ONCHAIN_PROPOSAL_TYPES;
proposalSchema.statics.OFFCHAIN_PROPOSAL_TYPES = OFFCHAIN_PROPOSAL_TYPES;

module.exports = mongoose.model('Proposal', proposalSchema);
module.exports.PROPOSAL_TYPES = PROPOSAL_TYPES;
module.exports.PROPOSAL_STATUSES = PROPOSAL_STATUSES;
module.exports.ONCHAIN_PROPOSAL_TYPES = ONCHAIN_PROPOSAL_TYPES;
module.exports.OFFCHAIN_PROPOSAL_TYPES = OFFCHAIN_PROPOSAL_TYPES;
