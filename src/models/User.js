const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
  passwordHash: { type: String },
  // Roles: 'sub_admin' is the canonical name for a reviewer/legal expert
  // (frontend `sub_admin`). 'regulator_admin' is kept as a DEPRECATED alias so
  // existing tokens/data keep working; see utils/roles.js for normalization and
  // migrations/migrate-p1.js to convert legacy records.
  role: {
    type: String,
    enum: ['company_admin', 'regulator_admin', 'sub_admin', 'super_admin'],
    required: true,
  },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
  regulatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Regulator', default: null },
  // Link to the SubAdmin profile (set for reviewer accounts).
  subAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubAdmin', default: null },
  walletAddress: { type: String, index: true, default: null },
  isActive: { type: Boolean, default: true },
  lastLoginAt: { type: Date },
  // Brute-force lockout (audit #5): incremented on failed login, cleared on
  // success; lockedUntil blocks login while in the future.
  failedLoginCount: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
