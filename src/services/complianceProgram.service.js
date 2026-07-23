// src/services/complianceProgram.service.js
// ---------------------------------------------------------------------------
// Admin-managed Compliance Programs (replaces the read-only Frameworks surface).
// Only the Main Admin (super_admin) may create/edit/archive/delete a program and
// assign the sub-admins who run its review workflow.
// ---------------------------------------------------------------------------
const ComplianceProgram = require('../models/ComplianceProgram');
const SubAdmin = require('../models/SubAdmin');
const AppError = require('../utils/AppError');
const { paginate, iso } = require('../utils/serializers');

const { PROGRAM_TYPES, JURISDICTIONS } = ComplianceProgram;
const TYPE_LABELS = {
  expert_support: 'Expert Compliance Support',
  self_service: 'Self-Service',
};

function toProgram(p) {
  if (!p) return null;
  const o = typeof p.toObject === 'function' ? p.toObject() : p;
  const assignees = Array.isArray(o.assignedSubAdmins) ? o.assignedSubAdmins : [];
  return {
    id: String(o._id),
    name: o.name,
    type: o.type,
    typeLabel: TYPE_LABELS[o.type] || o.type,
    jurisdiction: o.jurisdiction,
    description: o.description || '',
    assignedSubAdmins: assignees.map((a) =>
      a && typeof a === 'object' && a._id
        ? { id: String(a._id), name: a.name, email: a.email }
        : String(a),
    ),
    archived: !!o.archived,
    createdAt: iso(o.createdAt),
    updatedAt: iso(o.updatedAt),
  };
}

function validateType(type) {
  if (!PROGRAM_TYPES.includes(type)) {
    throw new AppError(400, `type must be one of: ${PROGRAM_TYPES.join(', ')}`);
  }
}
function validateJurisdiction(j) {
  if (!JURISDICTIONS.includes(j)) {
    throw new AppError(400, `jurisdiction must be one of: ${JURISDICTIONS.join(', ')}`);
  }
}

async function listPrograms({ page = 1, limit = 100, type, jurisdiction, includeArchived = false } = {}) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));
  const filter = {};
  if (!includeArchived) filter.archived = false;
  if (type) filter.type = type;
  if (jurisdiction) filter.jurisdiction = jurisdiction;
  const [items, total] = await Promise.all([
    ComplianceProgram.find(filter)
      .populate('assignedSubAdmins', 'name email')
      .sort({ jurisdiction: 1, name: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    ComplianceProgram.countDocuments(filter),
  ]);
  return paginate(items.map(toProgram), { page, limit, total });
}

async function getProgram(id) {
  const p = await ComplianceProgram.findById(id).populate('assignedSubAdmins', 'name email');
  if (!p) throw new AppError(404, 'Compliance program not found');
  return toProgram(p);
}

async function createProgram({ name, type, jurisdiction, description = '' }) {
  if (!name || !name.trim()) throw new AppError(400, 'name is required');
  validateType(type);
  validateJurisdiction(jurisdiction);
  const p = await ComplianceProgram.create({ name: name.trim(), type, jurisdiction, description: description || '' });
  return getProgram(p._id);
}

async function updateProgram(id, { name, type, jurisdiction, description }) {
  const p = await ComplianceProgram.findById(id);
  if (!p) throw new AppError(404, 'Compliance program not found');
  if (name !== undefined) {
    if (!name.trim()) throw new AppError(400, 'name cannot be empty');
    p.name = name.trim();
  }
  if (type !== undefined) { validateType(type); p.type = type; }
  if (jurisdiction !== undefined) { validateJurisdiction(jurisdiction); p.jurisdiction = jurisdiction; }
  if (description !== undefined) p.description = description;
  await p.save();
  return getProgram(p._id);
}

async function setArchived(id, archived) {
  const p = await ComplianceProgram.findById(id);
  if (!p) throw new AppError(404, 'Compliance program not found');
  p.archived = !!archived;
  await p.save();
  return getProgram(p._id);
}

async function deleteProgram(id) {
  const p = await ComplianceProgram.findById(id);
  if (!p) throw new AppError(404, 'Compliance program not found');
  await p.deleteOne();
  return { id: String(id), deleted: true };
}

async function assignSubAdmins(id, subAdminIds = []) {
  if (!Array.isArray(subAdminIds)) throw new AppError(400, 'subAdminIds must be an array');
  const p = await ComplianceProgram.findById(id);
  if (!p) throw new AppError(404, 'Compliance program not found');
  if (subAdminIds.length) {
    const found = await SubAdmin.find({ _id: { $in: subAdminIds } }).select('_id');
    if (found.length !== subAdminIds.length) throw new AppError(400, 'One or more sub-admins not found');
  }
  p.assignedSubAdmins = subAdminIds;
  await p.save();
  return getProgram(p._id);
}

module.exports = {
  listPrograms,
  getProgram,
  createProgram,
  updateProgram,
  setArchived,
  deleteProgram,
  assignSubAdmins,
  toProgram,
};
