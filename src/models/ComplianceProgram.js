// src/models/ComplianceProgram.js
// ---------------------------------------------------------------------------
// A Compliance Program offered by AITT. This replaces the old external
// "Framework" concept: the platform no longer manages regulations (GDPR, ISO,
// HIPAA…) — it manages its own AITT certification programs.
//
// A program has:
//   - a delivery TYPE (who prepares the documentation):
//       expert_support = Expert Compliance Support (AITT prepares + certifies)
//       self_service   = Self-Service (client prepares, AITT reviews + certifies)
//   - a JURISDICTION (EU | US)
//   - assigned Sub-Admins the Main Admin lets run its review workflow.
//
// Admin-managed (Main Admin CRUD). Sub-admins can never create/delete programs.
// ---------------------------------------------------------------------------
const mongoose = require('mongoose');

const PROGRAM_TYPES = ['expert_support', 'self_service'];
const JURISDICTIONS = ['EU', 'US'];

const complianceProgramSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },                 // e.g. "AI Governance"
  type: { type: String, enum: PROGRAM_TYPES, required: true, index: true },
  jurisdiction: { type: String, enum: JURISDICTIONS, required: true, index: true },
  description: { type: String, default: '' },

  // Sub-admins the Main Admin has assigned to run this program's review workflow
  // (document reviews, comments, statuses, scores). Assignment ≠ ownership: only
  // the Main Admin can create/edit/archive/delete the program itself.
  assignedSubAdmins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SubAdmin' }],

  // Soft lifecycle: archived programs are hidden from active lists but retained
  // so historical certificates keep their program reference.
  archived: { type: Boolean, default: false, index: true },
}, { timestamps: true });

const ComplianceProgram = mongoose.model('ComplianceProgram', complianceProgramSchema);
ComplianceProgram.PROGRAM_TYPES = PROGRAM_TYPES;
ComplianceProgram.JURISDICTIONS = JURISDICTIONS;

module.exports = ComplianceProgram;
