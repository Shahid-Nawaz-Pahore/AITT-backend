// src/utils/roles.js
// ---------------------------------------------------------------------------
// Role normalization between the backend (DB / JWT) role vocabulary and the
// frontend role vocabulary (frontend-aitt/src/mock/types.ts -> `Role`).
//
// Backend roles (User.role enum):  company_admin | regulator_admin | super_admin
// Frontend roles (types.ts Role):  public | company | sub_admin | admin
//
// Per the build brief, `regulator_admin` is the backend alias for the
// frontend `sub_admin`. This module is the single source of truth for that
// mapping so controllers / route guards / serializers stay consistent.
// ---------------------------------------------------------------------------

// Canonical backend roles
const BACKEND_ROLES = Object.freeze({
  COMPANY: 'company_admin',
  SUB_ADMIN: 'regulator_admin',
  ADMIN: 'super_admin',
});

// Frontend roles (must match types.ts exactly)
const FRONTEND_ROLES = Object.freeze({
  PUBLIC: 'public',
  COMPANY: 'company',
  SUB_ADMIN: 'sub_admin',
  ADMIN: 'admin',
});

const BACKEND_TO_FRONTEND = Object.freeze({
  company_admin: 'company',
  regulator_admin: 'sub_admin',
  super_admin: 'admin',
});

const FRONTEND_TO_BACKEND = Object.freeze({
  company: 'company_admin',
  sub_admin: 'regulator_admin',
  admin: 'super_admin',
  public: null,
});

// Accept a few aliases (frontend names, legacy names) and resolve them to the
// canonical backend role string used by the User model + requireAuth().
const ALIASES = Object.freeze({
  company_admin: 'company_admin',
  regulator_admin: 'regulator_admin',
  super_admin: 'super_admin',
  // frontend / friendly aliases
  company: 'company_admin',
  sub_admin: 'regulator_admin',
  subadmin: 'regulator_admin',
  regulator: 'regulator_admin',
  admin: 'super_admin',
});

/**
 * Resolve any accepted role string (backend canonical, frontend, or alias) to
 * the canonical backend role. Returns null for unknown / public.
 */
function normalizeRole(role) {
  if (!role) return null;
  return ALIASES[String(role).toLowerCase()] || null;
}

/** Backend role -> frontend role. Unknown/empty -> 'public'. */
function toFrontendRole(role) {
  const canonical = normalizeRole(role);
  return BACKEND_TO_FRONTEND[canonical] || FRONTEND_ROLES.PUBLIC;
}

/** Frontend role -> backend role. 'public'/unknown -> null. */
function toBackendRole(role) {
  if (!role) return null;
  const key = String(role).toLowerCase();
  if (key in FRONTEND_TO_BACKEND) return FRONTEND_TO_BACKEND[key];
  return normalizeRole(key);
}

const isAdmin = (role) => normalizeRole(role) === BACKEND_ROLES.ADMIN;
const isSubAdmin = (role) => normalizeRole(role) === BACKEND_ROLES.SUB_ADMIN;
const isCompany = (role) => normalizeRole(role) === BACKEND_ROLES.COMPANY;

/** A reviewer is a sub-admin; admins inherit reviewer/governance powers. */
const canReview = (role) => isSubAdmin(role) || isAdmin(role);
const canGovern = (role) => isSubAdmin(role) || isAdmin(role);

// Convenience guard sets (backend role strings) for requireAuth([...]).
const ADMIN_ONLY = Object.freeze([BACKEND_ROLES.ADMIN]);
const SUBADMIN_OR_ADMIN = Object.freeze([BACKEND_ROLES.SUB_ADMIN, BACKEND_ROLES.ADMIN]);
const COMPANY_OR_ADMIN = Object.freeze([BACKEND_ROLES.COMPANY, BACKEND_ROLES.ADMIN]);
const ANY_AUTHENTICATED = Object.freeze([
  BACKEND_ROLES.COMPANY,
  BACKEND_ROLES.SUB_ADMIN,
  BACKEND_ROLES.ADMIN,
]);

/**
 * Expand a list of required roles (which may contain frontend names or aliases)
 * into the set of canonical backend roles accepted by requireAuth().
 */
function expandRoles(roles = []) {
  const out = new Set();
  for (const r of roles) {
    const canonical = normalizeRole(r);
    if (canonical) out.add(canonical);
  }
  return Array.from(out);
}

module.exports = {
  BACKEND_ROLES,
  FRONTEND_ROLES,
  BACKEND_TO_FRONTEND,
  FRONTEND_TO_BACKEND,
  normalizeRole,
  toFrontendRole,
  toBackendRole,
  isAdmin,
  isSubAdmin,
  isCompany,
  canReview,
  canGovern,
  expandRoles,
  ADMIN_ONLY,
  SUBADMIN_OR_ADMIN,
  COMPANY_OR_ADMIN,
  ANY_AUTHENTICATED,
};
