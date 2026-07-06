const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  // Split-token pattern (E-audit H3): the raw token is `selector.verifier`. The
  // `selector` is a random public id used for O(1) lookup (indexed); `tokenHash`
  // is bcrypt(verifier). This avoids the O(n) bcrypt scan over all tokens and
  // keeps reuse-detection working at scale. `selector` is sparse+unique so legacy
  // rows (no selector) don't collide.
  selector: { type: String, index: true, unique: true, sparse: true },
  tokenHash: { type: String, required: true, index: true },
  userAgent: { type: String },
  ip: { type: String },
  expiresAt: { type: Date, required: true, index: true },
  revokedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
