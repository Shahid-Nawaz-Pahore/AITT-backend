const mongoose = require('mongoose');

const web3TxSchema = new mongoose.Schema({
  network: { type: String, enum: ['testnet', 'mainnet'], default: 'testnet' },
  purpose: { type: String, enum: ['issue', 'validate', 'revoke', 'other'], index: true },
  certificateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Certificate' },
  submittedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  txHash: { type: String, index: true },
  status: { type: String, enum: ['submitted', 'confirmed', 'failed'], default: 'submitted' },
  latencyMs: { type: Number },
  fee: { type: String },
  requestDump: { type: Object },
  responseDump: { type: Object }
}, { timestamps: true });

module.exports = mongoose.model('Web3Tx', web3TxSchema);
