// __tests__/decode.unit.test.js
// Pure unit tests for the real adapter's return-value decoders (decode.js).
// No chain / DB / env. These lock in the symmetric decode of the contract's
// Vec-encoded enums + stringified u64s back to stub-identical JS shapes.
const {
  toNum,
  decodeContractEnum,
  decodeProposalAction,
  decodeDocument,
  decodeVerifiedDocument,
  decodeReview,
  decodeProposal,
} = require('../src/services/sorobanAdapter/decode');

const ADDR = 'GAB6B3J2PE3NDVS4GZPJWHTSMYIFSTVIYRKOEYROPGM46A4YJCKCYKQW';
const HASH = 'e2e9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f';
const WASM = '0f4bae0374cabe088f188087465ccc63e6d30b49a7a8038ae26624450eeefad7';

describe('decode — primitives', () => {
  it('toNum coerces decimal strings/bigints, preserves null/undefined', () => {
    expect(toNum('2000000000')).toBe(2000000000);
    expect(toNum(85)).toBe(85);
    expect(toNum(0n)).toBe(0);
    expect(toNum(null)).toBeNull();
    expect(toNum(undefined)).toBeUndefined();
  });

  it('decodeContractEnum: Vec[Symbol] -> name; idempotent on strings', () => {
    expect(decodeContractEnum(['Issued'])).toBe('Issued');
    expect(decodeContractEnum(['ApprovedWithRecommendations'])).toBe('ApprovedWithRecommendations');
    expect(decodeContractEnum('Revoked')).toBe('Revoked'); // already-decoded
    expect(decodeContractEnum(null)).toBeNull();
  });
});

describe('decode — ProposalAction (mirror of actionToScVal)', () => {
  it('RevokeCertificate(String) -> { type, docHash }', () => {
    expect(decodeProposalAction(['RevokeCertificate', HASH])).toEqual({ type: 'RevokeCertificate', docHash: HASH });
  });
  it('UpdateThreshold(u32) -> { type, value:Number }', () => {
    expect(decodeProposalAction(['UpdateThreshold', 5])).toEqual({ type: 'UpdateThreshold', value: 5 });
    expect(decodeProposalAction(['UpdateThreshold', '7'])).toEqual({ type: 'UpdateThreshold', value: 7 });
  });
  it('ContractUpgrade(BytesN<32>) -> { type, wasmHash:hex }', () => {
    expect(decodeProposalAction(['ContractUpgrade', WASM])).toEqual({ type: 'ContractUpgrade', wasmHash: WASM });
  });
  it('is idempotent on an already-normalized action object', () => {
    const norm = { type: 'RevokeCertificate', docHash: HASH };
    expect(decodeProposalAction(norm)).toBe(norm);
  });
  it('null -> null', () => {
    expect(decodeProposalAction(null)).toBeNull();
  });
});

describe('decode — structs match the stub shape exactly', () => {
  it('decodeDocument: enum->string, u64->Number', () => {
    const raw = { name: 'Q4.pdf', hash: HASH, timestamp: '1782223369', added_by: ADDR, status: ['Revoked'], expiry: '2000000000' };
    expect(decodeDocument(raw)).toEqual({
      name: 'Q4.pdf', hash: HASH, timestamp: 1782223369, added_by: ADDR, status: 'Revoked', expiry: 2000000000,
    });
    expect(decodeDocument(null)).toBeNull();
  });

  it('decodeVerifiedDocument: certificate_status->string, verified_document->bool', () => {
    const raw = { name: 'Q4.pdf', hash: HASH, timestamp: '1782223369', added_by: ADDR, verified_document: false, certificate_status: ['Issued'], expiry: '2000000000' };
    const out = decodeVerifiedDocument(raw);
    expect(out.certificate_status).toBe('Issued');
    expect(out.verified_document).toBe(false);
    expect(out.expiry).toBe(2000000000);
    expect(typeof out.timestamp).toBe('number');
  });

  it('decodeReview: status->string, score+timestamp->Number', () => {
    const raw = { reviewer: ADDR, status: ['ApprovedWithRecommendations'], score: 85, comment_hash: 'ipfs://x', timestamp: '1782223399' };
    expect(decodeReview(raw)).toEqual({
      reviewer: ADDR, status: 'ApprovedWithRecommendations', score: 85, comment_hash: 'ipfs://x', timestamp: 1782223399,
    });
  });

  it('decodeProposal: id->Number, action->object, approvals[] preserved, executed->bool', () => {
    const raw = { id: '1', action: ['RevokeCertificate', HASH], approvals: [ADDR], executed: true };
    expect(decodeProposal(raw)).toEqual({
      id: 1, action: { type: 'RevokeCertificate', docHash: HASH }, approvals: [ADDR], executed: true,
    });
    // empty approvals + unexecuted
    expect(decodeProposal({ id: '2', action: ['UpdateThreshold', 5], approvals: [], executed: false })).toEqual({
      id: 2, action: { type: 'UpdateThreshold', value: 5 }, approvals: [], executed: false,
    });
    expect(decodeProposal(null)).toBeNull();
  });
});
