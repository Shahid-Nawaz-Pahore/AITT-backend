// __tests__/live/adapter.writes.live.test.js
// ---------------------------------------------------------------------------
// Validate EVERY write method against the deployed contract, each proven by a
// follow-up read of the on-chain effect. Custodial signing: main-admin-gated
// writes use the default service key (wallet-01); actor-gated writes pass
// { signerSecret } so the tx SOURCE == the address the contract require_auth's
// (source-account auth then satisfies require_auth without separate entries).
//
// transfer_main_admin is validated by SIMULATION ONLY — submitting it would
// move main-admin control of the shared deployed contract to another key, an
// unnecessary risk to prove a one-Address encoding that simulation fully
// exercises (encoding + current-admin auth + "must be different" branch).
// ---------------------------------------------------------------------------
const { liveDescribe, resetRpc, wallets, pub, sec, freshHash } = require('./_liveEnv');
const { realAdapter } = require('../../src/services/sorobanAdapter/real');
const rpc = require('../../src/services/sorobanAdapter/rpc');

liveDescribe('real adapter — writes (live)', () => {
  const txHashes = [];
  const track = (label, r) => { if (r && r.hash) txHashes.push(`${label}: ${r.hash}`); return r; };
  const HASH = freshHash('w');
  const EXPIRY = Math.floor(Date.now() / 1000) + 365 * 24 * 3600; // 1y out

  beforeAll(() => { resetRpc(); });
  afterAll(() => {
    // eslint-disable-next-line no-console
    console.log('\n=== I2 live write tx hashes ===\n' + txHashes.join('\n') + '\n');
  });

  it('whitelist_address + remove_from_whitelist round-trip (wallet-05)', async () => {
    const addr = pub(wallets.companyB);
    track('whitelist_address', await realAdapter.whitelistAddress(addr));
    expect(await realAdapter.isWhitelisted(addr)).toBe(true);
    track('remove_from_whitelist', await realAdapter.removeFromWhitelist(addr));
    expect(await realAdapter.isWhitelisted(addr)).toBe(false);
  });

  it('add_sub_admin + remove_sub_admin round-trip (wallet-10)', async () => {
    const admin = pub(wallets.mainAdmin);
    const sub = pub(wallets.subAdminC);
    track('add_sub_admin', await realAdapter.addSubAdmin(admin, sub));
    expect(await realAdapter.isSubAdmin(sub)).toBe(true);
    track('remove_sub_admin', await realAdapter.removeSubAdmin(admin, sub));
    expect(await realAdapter.isSubAdmin(sub)).toBe(false);
  });

  it('set_threshold round-trip (restores to 2)', async () => {
    const admin = pub(wallets.mainAdmin);
    const start = await realAdapter.governanceThreshold();
    const other = start === 1 ? 3 : 1;
    track('set_threshold->other', await realAdapter.setThreshold(admin, other));
    expect(await realAdapter.governanceThreshold()).toBe(other);
    track('set_threshold->2', await realAdapter.setThreshold(admin, 2));
    expect(await realAdapter.governanceThreshold()).toBe(2);
  });

  it('store_document by company (wallet-04) -> Submitted, added_by company', async () => {
    track('store_document', await realAdapter.storeDocument(
      pub(wallets.companyA), 'I2-Live-Doc.pdf', HASH, { signerSecret: sec(wallets.companyA) },
    ));
    const doc = await realAdapter.readDocument(HASH);
    expect(doc.status).toBe('Submitted');
    expect(doc.added_by).toBe(pub(wallets.companyA));
    expect(doc.expiry).toBe(0);
  });

  it('submit_review by sub-admin (wallet-02) -> review stored with decoded enum', async () => {
    track('submit_review', await realAdapter.submitReview(
      pub(wallets.subAdminA), HASH, 'ApprovedWithRecommendations', 88, 'ipfs://QmI2Review',
      { signerSecret: sec(wallets.subAdminA) },
    ));
    const rv = await realAdapter.readReview(HASH, pub(wallets.subAdminA));
    expect(rv.status).toBe('ApprovedWithRecommendations');
    expect(rv.score).toBe(88);
    expect(rv.comment_hash).toBe('ipfs://QmI2Review');
  });

  it('issue_certificate by main admin -> Issued + verified', async () => {
    track('issue_certificate', await realAdapter.issueCertificate(pub(wallets.mainAdmin), HASH, EXPIRY));
    const v = await realAdapter.verifyDocument(HASH);
    expect(v.certificate_status).toBe('Issued');
    expect(v.verified_document).toBe(true);
    expect(v.expiry).toBe(EXPIRY);
  });

  it('create_proposal + approve_proposal (RevokeCertificate via governance) -> Revoked', async () => {
    // Deterministic threshold of 2 for this revoke.
    await realAdapter.setThreshold(pub(wallets.mainAdmin), 2);
    expect(await realAdapter.governanceThreshold()).toBe(2);

    const created = track('create_proposal', await realAdapter.createProposal(
      pub(wallets.subAdminA), { type: 'RevokeCertificate', docHash: HASH },
      { signerSecret: sec(wallets.subAdminA) },
    ));
    expect(typeof created.proposalId).toBe('number');
    const id = created.proposalId;

    let p = await realAdapter.readProposal(id);
    expect(p.action).toEqual({ type: 'RevokeCertificate', docHash: HASH });
    expect(p.executed).toBe(false);
    expect(p.approvals).toEqual([]);

    // 1st approval — threshold not met.
    track('approve#1', await realAdapter.approveProposal(pub(wallets.subAdminA), id, { signerSecret: sec(wallets.subAdminA) }));
    p = await realAdapter.readProposal(id);
    expect(p.approvals).toContain(pub(wallets.subAdminA));
    expect(p.executed).toBe(false);

    // 2nd approval — threshold met -> auto-execute -> doc Revoked.
    track('approve#2', await realAdapter.approveProposal(pub(wallets.subAdminB), id, { signerSecret: sec(wallets.subAdminB) }));
    p = await realAdapter.readProposal(id);
    expect(p.executed).toBe(true);
    expect(p.approvals).toHaveLength(2);

    const v = await realAdapter.verifyDocument(HASH);
    expect(v.certificate_status).toBe('Revoked');
    expect(v.verified_document).toBe(false);
  });

  it('transfer_main_admin: validated by simulation (NOT submitted)', async () => {
    // Simulate transfer to a different address; current admin (service key) is
    // the tx source so require_auth + the "must be different" branch are
    // exercised. fetchValue simulates without submitting -> no state change.
    await expect(
      rpc.fetchValue('transfer_main_admin', [rpc.addressScVal(pub(wallets.subAdminC))]),
    ).resolves.toBeNull();
    // main admin is unchanged.
    expect(await realAdapter.mainAdminAddress()).toBe(pub(wallets.mainAdmin));
  });
});
