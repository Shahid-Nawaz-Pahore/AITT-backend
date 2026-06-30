// src/services/framework.service.js
// ---------------------------------------------------------------------------
// Frameworks are READ-ONLY via the API (decision A): all writes go through the
// off-chain `framework_update` multi-sig proposal (proposal.service.js). This
// just lists/reads them (e.g. for the document Submit dropdown).
// ---------------------------------------------------------------------------
const Framework = require('../models/Framework');
const AppError = require('../utils/AppError');
const { toFramework, paginate } = require('../utils/serializers');

async function listFrameworks({ page = 1, limit = 50, activeOnly = true } = {}) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const filter = activeOnly ? { active: true } : {};
  const [items, total] = await Promise.all([
    Framework.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit),
    Framework.countDocuments(filter),
  ]);
  return paginate(items.map(toFramework), { page, limit, total });
}

async function getFramework(id) {
  const f = await Framework.findById(id);
  if (!f) throw new AppError(404, 'Framework not found');
  return toFramework(f);
}

module.exports = { listFrameworks, getFramework };
