// __tests__/roles.unit.test.js
// Pure-logic unit tests for src/utils/roles.js (no DB / chain / fs).
const roles = require('../src/utils/roles');

describe('normalizeRole()', () => {
  it('passes through canonical backend roles', () => {
    expect(roles.normalizeRole('company_admin')).toBe('company_admin');
    expect(roles.normalizeRole('regulator_admin')).toBe('regulator_admin');
    expect(roles.normalizeRole('super_admin')).toBe('super_admin');
  });

  it('resolves frontend / friendly aliases to the canonical backend role', () => {
    expect(roles.normalizeRole('company')).toBe('company_admin');
    expect(roles.normalizeRole('sub_admin')).toBe('regulator_admin');
    expect(roles.normalizeRole('subadmin')).toBe('regulator_admin');
    expect(roles.normalizeRole('regulator')).toBe('regulator_admin');
    expect(roles.normalizeRole('admin')).toBe('super_admin');
  });

  it('is case-insensitive and returns null for unknown / empty / public', () => {
    expect(roles.normalizeRole('ADMIN')).toBe('super_admin');
    expect(roles.normalizeRole('public')).toBeNull();
    expect(roles.normalizeRole('nope')).toBeNull();
    expect(roles.normalizeRole(null)).toBeNull();
  });
});

describe('toFrontendRole() / toBackendRole()', () => {
  it('backend -> frontend', () => {
    expect(roles.toFrontendRole('company_admin')).toBe('company');
    expect(roles.toFrontendRole('regulator_admin')).toBe('sub_admin');
    expect(roles.toFrontendRole('super_admin')).toBe('admin');
    expect(roles.toFrontendRole('nonsense')).toBe('public');
  });

  it('frontend -> backend', () => {
    expect(roles.toBackendRole('company')).toBe('company_admin');
    expect(roles.toBackendRole('sub_admin')).toBe('regulator_admin');
    expect(roles.toBackendRole('admin')).toBe('super_admin');
    expect(roles.toBackendRole('public')).toBeNull();
  });

  it('round-trips backend -> frontend -> backend', () => {
    for (const backend of ['company_admin', 'regulator_admin', 'super_admin']) {
      expect(roles.toBackendRole(roles.toFrontendRole(backend))).toBe(backend);
    }
  });
});

describe('predicates', () => {
  it('isAdmin / isSubAdmin / isCompany work on aliases too', () => {
    expect(roles.isAdmin('admin')).toBe(true);
    expect(roles.isAdmin('super_admin')).toBe(true);
    expect(roles.isSubAdmin('sub_admin')).toBe(true);
    expect(roles.isSubAdmin('regulator_admin')).toBe(true);
    expect(roles.isCompany('company')).toBe(true);
    expect(roles.isCompany('company_admin')).toBe(true);
  });

  it('canReview / canGovern — sub-admins and admins only', () => {
    expect(roles.canReview('sub_admin')).toBe(true);
    expect(roles.canReview('admin')).toBe(true);
    expect(roles.canReview('company')).toBe(false);
    expect(roles.canGovern('regulator_admin')).toBe(true);
    expect(roles.canGovern('company_admin')).toBe(false);
  });
});

describe('expandRoles()', () => {
  it('expands a mixed list of frontend/alias/backend names to canonical backend roles', () => {
    const expanded = roles.expandRoles(['admin', 'sub_admin', 'company_admin']).sort();
    expect(expanded).toEqual(['company_admin', 'regulator_admin', 'super_admin']);
  });

  it('drops unknown / public entries', () => {
    expect(roles.expandRoles(['public', 'mystery'])).toEqual([]);
  });

  it('SUBADMIN_OR_ADMIN guard set contains the reviewer + admin backend roles', () => {
    expect(roles.SUBADMIN_OR_ADMIN).toEqual(['regulator_admin', 'super_admin']);
  });
});
