const mongoose = require('mongoose');

const apiKeySchema = new mongoose.Schema({
  ownerType: { type: String, enum: ['company', 'regulator'], required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  name: { type: String },
  prefix: { type: String, index: true },
  hash: { type: String, required: true },
  scopes: [{ type: String }],
  isActive: { type: Boolean, default: true },
  expiresAt: { type: Date },
  lastUsedAt: { type: Date },
  createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

apiKeySchema.index({ ownerType: 1, ownerId: 1, isActive: 1 });
module.exports = mongoose.model('ApiKey', apiKeySchema);
