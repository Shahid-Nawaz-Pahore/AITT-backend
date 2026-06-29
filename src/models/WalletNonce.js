const mongoose = require('mongoose');

const walletNonceSchema = new mongoose.Schema({
  walletAddress: { type: String, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  nonce: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date }
}, { timestamps: true });

walletNonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('WalletNonce', walletNonceSchema);
