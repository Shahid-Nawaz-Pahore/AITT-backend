const mongoose = require('mongoose');

// Every distinct on-chain (or stubbed) operation we may anchor. The pre-P1 enum
// only had issue/validate/revoke/other — which silently rejected the
// init/whitelist/transfer txs the service was already trying to record. P2 wraps
// the full deployed ABI behind the sorobanAdapter, so this enumerates every
// write purpose plus 'validate'/'other' kept for backward compatibility.
const TX_PURPOSES = [
  'init',
  'store',            // store_document
  'issue',            // issue_certificate
  'review',           // submit_review
  'revoke',           // RevokeCertificate proposal execution
  'whitelist',        // whitelist_address
  'remove_whitelist', // remove_from_whitelist
  'add_sub_admin',    // add_sub_admin
  'remove_sub_admin', // remove_sub_admin
  'set_threshold',    // set_threshold
  'transfer',         // transfer_main_admin
  'create_proposal',  // create_proposal
  'approve_proposal', // approve_proposal
  'validate',         // legacy (removed flow) — kept for old records
  'other',
];

const web3TxSchema = new mongoose.Schema({
  network: { type: String, enum: ['testnet', 'mainnet'], default: 'testnet' },
  purpose: { type: String, enum: TX_PURPOSES, index: true },
  certificateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Certificate' },
  proposalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Proposal' },
  submittedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  txHash: { type: String, index: true },
  // 'simulated' marks a tx produced by the in-memory stub adapter (no real chain).
  status: { type: String, enum: ['submitted', 'confirmed', 'failed', 'simulated'], default: 'submitted' },
  // Which adapter produced this record ('real' | 'stub').
  source: { type: String, enum: ['real', 'stub'], default: 'real' },
  method: { type: String },   // raw contract method name
  ledger: { type: Number },
  latencyMs: { type: Number },
  fee: { type: String },
  requestDump: { type: Object },
  responseDump: { type: Object }
}, { timestamps: true });

web3TxSchema.statics.TX_PURPOSES = TX_PURPOSES;

module.exports = mongoose.model('Web3Tx', web3TxSchema);
module.exports.TX_PURPOSES = TX_PURPOSES;
