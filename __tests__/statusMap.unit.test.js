// __tests__/statusMap.unit.test.js
// Pure-logic unit tests for src/utils/statusMap.js (no DB / chain / fs).
const sm = require('../src/utils/statusMap');

describe('statusMap — value sets', () => {
  it('exposes exactly the 9 frontend DocStatus values', () => {
    expect(sm.DOC_STATUSES.slice().sort()).toEqual([
      'approved',
      'approved_with_recommendations',
      'expired',
      'issued',
      'rejected',
      'requires_changes',
      'revoked',
      'submitted',
      'under_review',
    ]);
  });

  it('exposes exactly the 4 ReviewDecision values', () => {
    expect(sm.REVIEW_DECISIONS.slice().sort()).toEqual([
      'approved',
      'approved_with_recommendations',
      'rejected',
      'requires_changes',
    ]);
  });
});

describe('decisionToContract() / contractToDecision()', () => {
  it('maps each frontend decision to the contract DocumentStatus enum name', () => {
    expect(sm.decisionToContract('approved')).toBe('Approved');
    expect(sm.decisionToContract('approved_with_recommendations')).toBe('ApprovedWithRecommendations');
    expect(sm.decisionToContract('requires_changes')).toBe('RequiresChanges');
    expect(sm.decisionToContract('rejected')).toBe('Rejected');
  });

  it('is case-insensitive and returns null for unknown / empty', () => {
    expect(sm.decisionToContract('APPROVED')).toBe('Approved');
    expect(sm.decisionToContract('nope')).toBeNull();
    expect(sm.decisionToContract(null)).toBeNull();
  });

  it('round-trips contract <-> decision', () => {
    for (const d of sm.REVIEW_DECISIONS) {
      expect(sm.contractToDecision(sm.decisionToContract(d))).toBe(d);
    }
  });

  it('contractToDecision returns null for unknown / empty', () => {
    expect(sm.contractToDecision('Bogus')).toBeNull();
    expect(sm.contractToDecision(null)).toBeNull();
  });
});

describe('mapLegacyStatus() — legacy 5-value -> new DocStatus', () => {
  it('maps requested -> submitted', () => {
    expect(sm.mapLegacyStatus('requested')).toBe('submitted');
  });

  it('maps validated -> issued (validated came after issuance)', () => {
    expect(sm.mapLegacyStatus('validated')).toBe('issued');
  });

  it('passes through issued / revoked / expired unchanged', () => {
    expect(sm.mapLegacyStatus('issued')).toBe('issued');
    expect(sm.mapLegacyStatus('revoked')).toBe('revoked');
    expect(sm.mapLegacyStatus('expired')).toBe('expired');
  });

  it('is case-insensitive and returns null for unknown / empty', () => {
    expect(sm.mapLegacyStatus('REQUESTED')).toBe('submitted');
    expect(sm.mapLegacyStatus('mystery')).toBeNull();
    expect(sm.mapLegacyStatus(null)).toBeNull();
  });

  it('every legacy value maps to a valid DocStatus', () => {
    for (const legacy of sm.LEGACY_STATUSES) {
      expect(sm.DOC_STATUSES).toContain(sm.mapLegacyStatus(legacy));
    }
  });
});

describe('guards isDocStatus() / isReviewDecision()', () => {
  it('isDocStatus', () => {
    expect(sm.isDocStatus('issued')).toBe(true);
    expect(sm.isDocStatus('validated')).toBe(false); // removed value
  });

  it('isReviewDecision', () => {
    expect(sm.isReviewDecision('rejected')).toBe(true);
    expect(sm.isReviewDecision('issued')).toBe(false);
  });
});
