// __tests__/sorobanAdapter.stub.unit.test.js
// The stub adapter must faithfully mirror the deployed contract's rules.
// Pure in-memory (no DB / chain / env).
const { createStubAdapter } = require('../src/services/sorobanAdapter/stub');
const adapterIndex = require('../src/services/sorobanAdapter');

const ADMIN = 'GADMIN0000000000000000000000000000000000000000000000000';
const SUB1 = 'GSUB10000000000000000000000000000000000000000000000000';
const SUB2 = 'GSUB20000000000000000000000000000000000000000000000000';
const COMP = 'GCOMP0000000000000000000000000000000000000000000000000';
const USER = 'GUSER0000000000000000000000000000000000000000000000000';
const HASH = 'a'.repeat(64);

function freshAdapter(over = {}) {
  let clock = 1000;
  const adapter = createStubAdapter({ mainAdmin: ADMIN, now: () => clock, ...over });
  return { adapter, setClock: (t) => { clock = t; } };
}

describe('stub adapter — document lifecycle', () => {
  it('store_document: whitelisted actor stores a Submitted doc; verify is not yet valid', async () => {
    const { adapter } = freshAdapter();
    await adapter.whitelistAddress(COMP);
    await adapter.storeDocument(COMP, 'Report.pdf', HASH);

    const doc = await adapter.readDocument(HASH);
    expect(doc.status).toBe('Submitted');
    expect(doc.added_by).toBe(COMP);

    const v = await adapter.verifyDocument(HASH);
    expect(v.certificate_status).toBe('Submitted');
    expect(v.verified_document).toBe(false);
  });

  it('store_document: non-whitelisted, non-admin actor is rejected', async () => {
    const { adapter } = freshAdapter();
    await expect(adapter.storeDocument(USER, 'x.pdf', HASH)).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('only main admin or whitelisted'),
    });
  });

  it('store_document: duplicate hash is rejected (mirrors "Document already registered")', async () => {
    const { adapter } = freshAdapter();
    await adapter.storeDocument(ADMIN, 'a.pdf', HASH);
    await expect(adapter.storeDocument(ADMIN, 'b.pdf', HASH)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('already registered'),
    });
  });

  it('issue_certificate: main-admin only, Submitted-only, then verify is valid', async () => {
    const { adapter } = freshAdapter();
    await adapter.storeDocument(ADMIN, 'a.pdf', HASH);

    // non-admin cannot issue
    await expect(adapter.issueCertificate(SUB1, HASH, 9_000_000_000)).rejects.toMatchObject({ statusCode: 403 });

    await adapter.issueCertificate(ADMIN, HASH, 9_000_000_000);
    const v = await adapter.verifyDocument(HASH);
    expect(v.certificate_status).toBe('Issued');
    expect(v.verified_document).toBe(true);

    // cannot issue twice (no longer Submitted)
    await expect(adapter.issueCertificate(ADMIN, HASH, 9_000_000_000)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('Submitted'),
    });
  });

  it('issue_certificate: NO on-chain review gate (issuing an un-reviewed doc succeeds on-chain)', async () => {
    const { adapter } = freshAdapter();
    await adapter.storeDocument(ADMIN, 'a.pdf', HASH);
    // never reviewed — contract still allows issuance (the gate lives in the backend)
    await expect(adapter.issueCertificate(ADMIN, HASH, 9_000_000_000)).resolves.toBeTruthy();
  });

  it('verify_document: an Issued doc past its expiry reports Expired + not valid', async () => {
    const { adapter, setClock } = freshAdapter();
    await adapter.storeDocument(ADMIN, 'a.pdf', HASH);
    await adapter.issueCertificate(ADMIN, HASH, 2000); // expiry at t=2000

    setClock(5000); // now past expiry
    const v = await adapter.verifyDocument(HASH);
    expect(v.certificate_status).toBe('Expired');
    expect(v.verified_document).toBe(false);
  });
});

describe('stub adapter — reviews', () => {
  it('submit_review: sub-admin only; overwrites per reviewer; no 0–100 check on-chain', async () => {
    const { adapter } = freshAdapter();
    await adapter.storeDocument(ADMIN, 'a.pdf', HASH);

    // not a sub-admin yet
    await expect(adapter.submitReview(SUB1, HASH, 'Approved', 90, 'cmt')).rejects.toMatchObject({ statusCode: 403 });

    await adapter.addSubAdmin(ADMIN, SUB1);
    await adapter.submitReview(SUB1, HASH, 'RequiresChanges', 40, 'c1');
    let r = await adapter.readReview(HASH, SUB1);
    expect(r.status).toBe('RequiresChanges');
    expect(r.score).toBe(40);

    // overwrite by the same reviewer
    await adapter.submitReview(SUB1, HASH, 'Approved', 999, 'c2'); // 999 accepted on-chain (no check)
    r = await adapter.readReview(HASH, SUB1);
    expect(r.status).toBe('Approved');
    expect(r.score).toBe(999);
  });
});

describe('stub adapter — multi-sig governance (3 on-chain actions)', () => {
  it('create_proposal starts with 0 approvals; proposer must be admin/sub-admin', async () => {
    const { adapter } = freshAdapter();
    await expect(adapter.createProposal(USER, { type: 'UpdateThreshold', value: 3 }))
      .rejects.toMatchObject({ statusCode: 403 });

    const { proposalId } = await adapter.createProposal(ADMIN, { type: 'UpdateThreshold', value: 3 });
    const p = await adapter.readProposal(proposalId);
    expect(p.approvals).toHaveLength(0);
    expect(p.executed).toBe(false);
  });

  it('approve_proposal auto-executes at threshold; double-approve is guarded', async () => {
    const { adapter } = freshAdapter({ threshold: 2 });
    await adapter.addSubAdmin(ADMIN, SUB1);
    await adapter.addSubAdmin(ADMIN, SUB2);
    await adapter.storeDocument(ADMIN, 'a.pdf', HASH);
    await adapter.issueCertificate(ADMIN, HASH, 9_000_000_000);

    const { proposalId } = await adapter.createProposal(SUB1, { type: 'RevokeCertificate', docHash: HASH });
    await adapter.approveProposal(SUB1, proposalId);

    // double approve by same sub-admin rejected
    await expect(adapter.approveProposal(SUB1, proposalId)).rejects.toMatchObject({ statusCode: 409 });

    // still not executed (1/2)
    let p = await adapter.readProposal(proposalId);
    expect(p.executed).toBe(false);
    expect((await adapter.readDocument(HASH)).status).toBe('Issued');

    // second approval -> auto-execute -> doc Revoked
    await adapter.approveProposal(SUB2, proposalId);
    p = await adapter.readProposal(proposalId);
    expect(p.executed).toBe(true);
    expect((await adapter.readDocument(HASH)).status).toBe('Revoked');

    // approving an executed proposal is rejected
    await expect(adapter.approveProposal(SUB1, proposalId)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('UpdateThreshold proposal changes the governance threshold on execution', async () => {
    const { adapter } = freshAdapter({ threshold: 1 });
    await adapter.addSubAdmin(ADMIN, SUB1);
    const { proposalId } = await adapter.createProposal(ADMIN, { type: 'UpdateThreshold', value: 5 });
    await adapter.approveProposal(SUB1, proposalId); // threshold 1 -> auto-executes
    expect(await adapter.governanceThreshold()).toBe(5);
  });
});

describe('adapter index — proposal action mapping (framework_update guard)', () => {
  it('maps the 3 on-chain proposal types to actions', () => {
    expect(adapterIndex.mapProposalAction('revocation', { docHash: HASH })).toEqual({ type: 'RevokeCertificate', docHash: HASH });
    expect(adapterIndex.mapProposalAction('governance_rule', { value: 3 })).toEqual({ type: 'UpdateThreshold', value: 3 });
    expect(adapterIndex.mapProposalAction('contract_upgrade', { wasmHash: '00' })).toEqual({ type: 'ContractUpgrade', wasmHash: '00' });
  });

  it('REJECTS framework_update at the chain boundary (gap #1 — off-chain only)', () => {
    expect(() => adapterIndex.mapProposalAction('framework_update', {})).toThrow(/off-chain/i);
    expect(adapterIndex.isOnChainProposalType('framework_update')).toBe(false);
    expect(adapterIndex.isOnChainProposalType('revocation')).toBe(true);
  });

  it('translates frontend ReviewDecision to contract DocumentStatus name', () => {
    expect(adapterIndex.reviewDecisionToContract('approved_with_recommendations')).toBe('ApprovedWithRecommendations');
    expect(adapterIndex.reviewDecisionToContract('rejected')).toBe('Rejected');
    expect(() => adapterIndex.reviewDecisionToContract('bogus')).toThrow();
  });

  it('exposes the full interface (8 reads + 12 writes) on the default adapter', () => {
    const adapter = adapterIndex.getAdapter({ fresh: true });
    for (const m of adapterIndex.INTERFACE_METHODS) {
      expect(typeof adapter[m]).toBe('function');
    }
    expect(adapterIndex.READ_METHODS).toHaveLength(8);
    expect(adapterIndex.WRITE_METHODS).toHaveLength(12);
  });
});
