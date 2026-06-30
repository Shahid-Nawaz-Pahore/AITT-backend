// __tests__/composeStatus.unit.test.js
// Pure-logic unit tests for src/utils/composeStatus.js (no DB / chain / fs).
const {
  composeStatus,
  composeFromCertificate,
  isIssuable,
  isIssuableCertificate,
  latestReview,
  overallComplianceScore,
} = require('../src/utils/composeStatus');

describe('composeStatus()', () => {
  it('Revoked lifecycle wins over any review', () => {
    expect(composeStatus('Revoked', 'approved')).toBe('revoked');
    expect(composeStatus('Revoked', null)).toBe('revoked');
  });

  it('Expired lifecycle wins over any review', () => {
    expect(composeStatus('Expired', 'approved')).toBe('expired');
  });

  it('Issued lifecycle wins over any review', () => {
    expect(composeStatus('Issued', 'requires_changes')).toBe('issued');
  });

  it('Submitted + no review -> submitted', () => {
    expect(composeStatus('Submitted', null)).toBe('submitted');
    expect(composeStatus('Submitted')).toBe('submitted');
  });

  it('Submitted + inReview flag -> under_review', () => {
    expect(composeStatus('Submitted', null, { inReview: true })).toBe('under_review');
  });

  it('Submitted + each decision -> the matching DocStatus', () => {
    expect(composeStatus('Submitted', 'approved')).toBe('approved');
    expect(composeStatus('Submitted', 'approved_with_recommendations')).toBe('approved_with_recommendations');
    expect(composeStatus('Submitted', 'requires_changes')).toBe('requires_changes');
    expect(composeStatus('Submitted', 'rejected')).toBe('rejected');
  });

  it('a decision is honored even when inReview is set (decision is more specific)', () => {
    expect(composeStatus('Submitted', 'approved', { inReview: true })).toBe('approved');
  });

  it('accepts contract DocumentStatus enum names for the decision', () => {
    expect(composeStatus('Submitted', 'ApprovedWithRecommendations')).toBe('approved_with_recommendations');
    expect(composeStatus('Submitted', 'RequiresChanges')).toBe('requires_changes');
  });

  it('accepts lowercase / object lifecycle inputs', () => {
    expect(composeStatus('issued', null)).toBe('issued');
    expect(composeStatus({ certificate_status: 'Revoked' }, 'approved')).toBe('revoked');
    expect(composeStatus({ status: 'Submitted' }, 'rejected')).toBe('rejected');
  });

  it('defaults unknown lifecycle to submitted', () => {
    expect(composeStatus('whoknows', null)).toBe('submitted');
    expect(composeStatus(null, null)).toBe('submitted');
  });

  it('only ever returns one of the 9 valid DocStatus values', () => {
    const NINE = [
      'submitted', 'under_review', 'requires_changes', 'approved',
      'approved_with_recommendations', 'issued', 'rejected', 'expired', 'revoked',
    ];
    const lifecycles = ['Submitted', 'Issued', 'Revoked', 'Expired', 'garbage'];
    const decisions = [null, 'approved', 'approved_with_recommendations', 'requires_changes', 'rejected'];
    for (const l of lifecycles) {
      for (const d of decisions) {
        expect(NINE).toContain(composeStatus(l, d));
      }
    }
  });
});

describe('latestReview()', () => {
  it('returns null for empty / invalid input', () => {
    expect(latestReview([])).toBeNull();
    expect(latestReview(null)).toBeNull();
    expect(latestReview(undefined)).toBeNull();
  });

  it('picks the most recent review by date', () => {
    const reviews = [
      { reviewer: 'A', decision: 'requires_changes', complianceScore: 40, date: '2026-01-01T00:00:00.000Z' },
      { reviewer: 'B', decision: 'approved', complianceScore: 90, date: '2026-03-01T00:00:00.000Z' },
      { reviewer: 'C', decision: 'rejected', complianceScore: 10, date: '2026-02-01T00:00:00.000Z' },
    ];
    expect(latestReview(reviews).reviewer).toBe('B');
  });
});

describe('isIssuable()', () => {
  it('true for approved / approved_with_recommendations', () => {
    expect(isIssuable('approved')).toBe(true);
    expect(isIssuable('approved_with_recommendations')).toBe(true);
    expect(isIssuable('ApprovedWithRecommendations')).toBe(true); // contract enum name
  });

  it('false for requires_changes / rejected / missing', () => {
    expect(isIssuable('requires_changes')).toBe(false);
    expect(isIssuable('rejected')).toBe(false);
    expect(isIssuable(null)).toBe(false);
    expect(isIssuable(undefined)).toBe(false);
  });

  it('isIssuableCertificate uses the latest embedded review', () => {
    const cert = {
      reviews: [
        { reviewer: 'A', decision: 'rejected', complianceScore: 20, date: '2026-01-01T00:00:00.000Z' },
        { reviewer: 'B', decision: 'approved', complianceScore: 95, date: '2026-02-01T00:00:00.000Z' },
      ],
    };
    expect(isIssuableCertificate(cert)).toBe(true);
    expect(isIssuableCertificate({ reviews: [] })).toBe(false);
  });
});

describe('overallComplianceScore() — latest wins (A6)', () => {
  it('returns the latest review score', () => {
    const reviews = [
      { decision: 'requires_changes', complianceScore: 50, date: '2026-01-01T00:00:00.000Z' },
      { decision: 'approved', complianceScore: 88, date: '2026-02-01T00:00:00.000Z' },
    ];
    expect(overallComplianceScore(reviews)).toBe(88);
  });

  it('returns null when there are no reviews', () => {
    expect(overallComplianceScore([])).toBeNull();
  });
});

describe('composeFromCertificate()', () => {
  it('composes from chain lifecycle + latest review', () => {
    const cert = {
      chain: { certificateStatus: 'Submitted' },
      reviews: [
        { decision: 'requires_changes', complianceScore: 30, date: '2026-01-01T00:00:00.000Z' },
        { decision: 'approved_with_recommendations', complianceScore: 80, date: '2026-02-01T00:00:00.000Z' },
      ],
    };
    expect(composeFromCertificate(cert)).toBe('approved_with_recommendations');
  });

  it('Issued lifecycle composes to issued regardless of reviews', () => {
    const cert = { chain: { certificateStatus: 'Issued' }, reviews: [{ decision: 'rejected', complianceScore: 5, date: '2026-01-01T00:00:00.000Z' }] };
    expect(composeFromCertificate(cert)).toBe('issued');
  });

  it('handles a null certificate', () => {
    expect(composeFromCertificate(null)).toBe('submitted');
  });
});
