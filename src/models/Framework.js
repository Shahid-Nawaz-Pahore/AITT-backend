// src/models/Framework.js
// ---------------------------------------------------------------------------
// A compliance framework (e.g. a regulatory standard a document is reviewed
// against). Mirrors frontend-aitt/src/mock/types.ts -> `Framework`
// (id, name, description).
//
// Framework changes are governed by BACKEND-ONLY (off-chain) `framework_update`
// proposals — the deployed contract has no FrameworkUpdate action (see the
// build brief's gap-compensation rule #1).
// ---------------------------------------------------------------------------
const mongoose = require('mongoose');

const frameworkSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },

  // Soft-delete / lifecycle flag so governance can deactivate without losing
  // historical references from documents.
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });

module.exports = mongoose.model('Framework', frameworkSchema);
