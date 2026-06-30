// src/models/SubAdmin.js
// ---------------------------------------------------------------------------
// A sub-admin (legal/compliance expert) — the backend's `regulator_admin` /
// frontend `sub_admin`. Mirrors frontend-aitt/src/mock/types.ts -> `SubAdmin`
// (id, name, email, wallet, reviewsDone, status) plus backend-only links.
//
// On-chain, a sub-admin is an Address registered via `add_sub_admin`; here we
// track the off-chain profile + the linked User account used to log in.
// ---------------------------------------------------------------------------
const mongoose = require('mongoose');

const subAdminSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },

  // Stellar address registered on-chain via add_sub_admin (the "named signer").
  walletAddress: { type: String, index: true, default: null },
  // Custodial secret for that wallet, ENCRYPTED at rest (utils/wallet.js). Never
  // serialized to clients. Used to sign this officer's submit_review/approve.
  walletSecretEnc: { type: String, default: null, select: false },

  // Number of reviews this sub-admin has submitted (frontend: reviewsDone).
  reviewsDone: { type: Number, default: 0, min: 0 },

  // 'invited' = created/invited but not yet on-chain/active; 'active' = registered.
  status: { type: String, enum: ['active', 'invited'], default: 'invited', index: true },

  // Linked login account (User.role === 'regulator_admin'/'sub_admin').
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Audit: who invited this sub-admin (main admin).
  invitedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Chain anchor for the add_sub_admin tx (set when activated on-chain).
  txHashAdd: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('SubAdmin', subAdminSchema);
