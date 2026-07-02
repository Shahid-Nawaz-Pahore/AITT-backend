// __tests__/live/adapter.reads.parity.live.test.js
// ---------------------------------------------------------------------------
// THE make-or-break test for the integration: the REAL adapter's read return
// values must be shaped EXACTLY like the in-memory STUB's, because the indexer,
// composeStatus, statusMap and reconcile were all built/tested against the stub.
// If real != stub shape, those silently break.
//
// Strategy: seed a stub to mirror the known on-chain fixtures (the executed
// RevokeCertificate from scripts/test_full.mjs leaves a Revoked doc with two
// reviews + three proposals covering all ProposalAction variants), then assert:
//   - identical TYPE SIGNATURES for every read, and
//   - DEEP EQUALITY for proposals (which carry no timestamps), incl. the
//     decoded ProposalAction enum — the headline decode crux.
// ---------------------------------------------------------------------------
const { liveDescribe, resetRpc, wallets, pub } = require('./_liveEnv');
const { createStubAdapter } = require('../../src/services/sorobanAdapter/stub');
const { realAdapter } = require('../../src/services/sorobanAdapter/real');

// Known on-chain fixtures (from the prior scripts/test_full.mjs run).
const DOC_HASH = 'e2e9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f';
const WASM_HASH = '0f4bae0374cabe088f188087465ccc63e6d30b49a7a8038ae26624450eeefad7';
const DOC_EXPIRY = 2000000000;

// Recursive type signature (arrays length-agnostic but element-typed; object
// keys sorted) so two values can be compared on shape alone.
function typeSig(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return `Array<${v.length ? typeSig(v[0]) : 'empty'}>`;
  if (typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${k}:${typeSig(v[k])}`).join(',')}}`;
  }
  return typeof v;
}

liveDescribe('STUB↔REAL read parity (live)', () => {
  let stub;

  beforeAll(async () => {
    resetRpc();
    // Mirror the on-chain state into a stub using the real wallet addresses.
    stub = createStubAdapter({ mainAdmin: pub(wallets.mainAdmin), threshold: 2 });
    await stub.addSubAdmin(pub(wallets.mainAdmin), pub(wallets.subAdminA));
    await stub.addSubAdmin(pub(wallets.mainAdmin), pub(wallets.subAdminB));
    // On-chain fixture was uploaded by the main admin (wallet-01) in test_full.mjs.
    await stub.storeDocument(pub(wallets.mainAdmin), 'Q4-Audit-Report.pdf', DOC_HASH);
    await stub.submitReview(pub(wallets.subAdminA), DOC_HASH, 'ApprovedWithRecommendations', 85, 'ipfs://QmReviewA');
    await stub.submitReview(pub(wallets.subAdminB), DOC_HASH, 'Approved', 92, 'ipfs://QmReviewB');
    await stub.issueCertificate(pub(wallets.mainAdmin), DOC_HASH, DOC_EXPIRY);
    // Proposal 1: RevokeCertificate, approved by A then B -> executed (doc Revoked).
    await stub.createProposal(pub(wallets.subAdminA), { type: 'RevokeCertificate', docHash: DOC_HASH });
    await stub.approveProposal(pub(wallets.subAdminA), 1);
    await stub.approveProposal(pub(wallets.subAdminB), 1);
    // Proposal 2: UpdateThreshold(5), unapproved.   Proposal 3: ContractUpgrade, unapproved.
    await stub.createProposal(pub(wallets.mainAdmin), { type: 'UpdateThreshold', value: 5 });
    await stub.createProposal(pub(wallets.mainAdmin), { type: 'ContractUpgrade', wasmHash: WASM_HASH });
  });

  it('scalar reads: same primitive types', async () => {
    expect(typeof (await realAdapter.mainAdminAddress())).toBe(typeof (await stub.mainAdminAddress())); // string
    expect(typeof (await realAdapter.governanceThreshold())).toBe('number');
    expect(typeof (await stub.governanceThreshold())).toBe('number');
    expect(typeof (await realAdapter.isSubAdmin(pub(wallets.subAdminA)))).toBe('boolean');
    expect(typeof (await realAdapter.isWhitelisted(pub(wallets.companyA)))).toBe('boolean');
    expect(await realAdapter.mainAdminAddress()).toBe(pub(wallets.mainAdmin));
  });

  it('readDocument: identical shape + matching non-timestamp values', async () => {
    const real = await realAdapter.readDocument(DOC_HASH);
    const ref = await stub.readDocument(DOC_HASH);
    expect(typeSig(real)).toBe(typeSig(ref));
    expect(real.status).toBe('Revoked');
    expect(ref.status).toBe('Revoked');
    expect(real.expiry).toBe(DOC_EXPIRY);
    expect(real.added_by).toBe(pub(wallets.mainAdmin));
    expect(real.added_by).toBe(ref.added_by); // stub seeded with same uploader
    expect(typeof real.timestamp).toBe('number');
    expect(typeof real.expiry).toBe('number');
  });

  it('verifyDocument: identical shape; certificate_status string, verified_document bool', async () => {
    const real = await realAdapter.verifyDocument(DOC_HASH);
    const ref = await stub.verifyDocument(DOC_HASH);
    expect(typeSig(real)).toBe(typeSig(ref));
    expect(real.certificate_status).toBe('Revoked');
    expect(real.verified_document).toBe(false);
    expect(typeof real.certificate_status).toBe('string');
    expect(typeof real.verified_document).toBe('boolean');
  });

  it('readReview: identical shape; status string, score number — values match seed', async () => {
    const real = await realAdapter.readReview(DOC_HASH, pub(wallets.subAdminA));
    const ref = await stub.readReview(DOC_HASH, pub(wallets.subAdminA));
    expect(typeSig(real)).toBe(typeSig(ref));
    expect(real.status).toBe('ApprovedWithRecommendations');
    expect(real.score).toBe(85);
    expect(real.comment_hash).toBe('ipfs://QmReviewA');
    expect(typeof real.timestamp).toBe('number');
  });

  it('readProposal: DEEP EQUAL real==stub for all 3 ProposalAction variants (decode crux)', async () => {
    // 1: RevokeCertificate(String)  -> { type:'RevokeCertificate', docHash }
    expect(await realAdapter.readProposal(1)).toEqual(await stub.readProposal(1));
    // 2: UpdateThreshold(u32)       -> { type:'UpdateThreshold', value:Number }
    expect(await realAdapter.readProposal(2)).toEqual(await stub.readProposal(2));
    // 3: ContractUpgrade(BytesN<32>)-> { type:'ContractUpgrade', wasmHash:hex }
    expect(await realAdapter.readProposal(3)).toEqual(await stub.readProposal(3));

    // explicit field-level proof of the enum decode
    const p1 = await realAdapter.readProposal(1);
    expect(p1).toEqual({
      id: 1,
      action: { type: 'RevokeCertificate', docHash: DOC_HASH },
      approvals: [pub(wallets.subAdminA), pub(wallets.subAdminB)],
      executed: true,
    });
    expect((await realAdapter.readProposal(2)).action).toEqual({ type: 'UpdateThreshold', value: 5 });
    expect((await realAdapter.readProposal(3)).action).toEqual({ type: 'ContractUpgrade', wasmHash: WASM_HASH });
  });

  it('missing records: real and stub both return null', async () => {
    const missing = 'deadbeef'.repeat(8); // 64 hex, never stored
    expect(await realAdapter.readDocument(missing)).toBeNull();
    expect(await stub.readDocument(missing)).toBeNull();
    expect(await realAdapter.verifyDocument(missing)).toBeNull();
    expect(await realAdapter.readProposal(99999)).toBeNull();
    expect(await stub.readProposal(99999)).toBeNull();
    expect(await realAdapter.readReview(DOC_HASH, pub(wallets.stranger))).toBeNull();
  });
});
