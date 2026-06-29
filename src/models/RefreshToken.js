const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  tokenHash: { type: String, required: true, index: true },
  userAgent: { type: String },
  ip: { type: String },
  expiresAt: { type: Date, required: true, index: true },
  revokedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
