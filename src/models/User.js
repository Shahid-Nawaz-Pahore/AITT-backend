const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
  passwordHash: { type: String },
  role: { type: String, enum: ['company_admin', 'regulator_admin', 'super_admin'], required: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
  regulatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Regulator', default: null },
  walletAddress: { type: String, index: true, default: null },
  isActive: { type: Boolean, default: true },
  lastLoginAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
