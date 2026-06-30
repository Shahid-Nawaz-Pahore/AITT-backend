// __tests__/indexer.int.test.js
// Write-through indexer against an in-memory Mongo + the stub adapter.
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Certificate = require('../src/models/Certificate');
const Company = require('../src/models/Company');
const SubAdmin = require('../src/models/SubAdmin');
const Web3Tx = require('../src/models/Web3Tx');
const { createStubAdapter } = require('../src/services/sorobanAdapter/stub');
const indexer = require('../src/services/indexer.service');

const ADMIN = 'GADMIN0000000000000000000000000000000000000000000000000';
const SUB1 = 'GSUB10000000000000000000000000000000000000000000000000';
const SUB2 = 'GSUB20000000000000000000000000000000000000000000000000';
const COMP = 'GCOMP0000000000000000000000000000000000000000000000000';
const HASH = 'b'.repeat(64);

let mongoServer;
let adapter;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'testdb' });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  for (const k in mongoose.connection.collections) await mongoose.connection.collections[k].deleteMany({});
  adapter = createStubAdapter({ mainAdmin: ADMIN });
  await adapter.whitelistAddress(COMP);
  await adapter.addSubAdmin(ADMIN, SUB1);
  await adapter.addSubAdmin(ADMIN, SUB2);
});

describe('writeThrough + recordTx', () => {
  it('store_document mirrors a submitted Certificate AND records a simulated Web3Tx', async () => {
    const { receipt, tx, mirrored } = await indexer.writeThrough({
      adapter,
      method: 'storeDocument',
      args: [COMP, 'Report.pdf', HASH],
      purpose: 'store',
      mirror: (r) => indexer.mirrorStoredDocument({
        metadataHash: HASH, certificateName: 'Report.pdf', subject: 'ISO-27001', companyId: null, receipt: r,
      }),
    });

    expect(receipt.source).toBe('stub');
    expect(mirrored.status).toBe('submitted');
    expect(mirrored.chain.certificateStatus).toBe('Submitted');
    expect(mirrored.chain.txHashStore).toBe(receipt.hash);

    // Web3Tx persisted with the stub markers.
    expect(tx).toBeTruthy();
    const persisted = await Web3Tx.findById(tx._id).lean();
    expect(persisted.purpose).toBe('store');
    expect(persisted.source).toBe('stub');
    expect(persisted.status).toBe('simulated');
    expect(persisted.txHash).toBe(receipt.hash);
  });
});

describe('mirrorReview — latest-wins score + composed status (A6, gap #4/#6)', () => {
  beforeEach(async () => {
    await adapter.storeDocument(COMP, 'Report.pdf', HASH);
    await indexer.mirrorStoredDocument({ metadataHash: HASH, certificateName: 'Report.pdf', subject: 'ISO-27001' });
  });

  it('one review per reviewer (overwrite); overall score follows the latest review', async () => {
    // SUB1 reviews requires_changes (40)
    await indexer.mirrorReview({
      metadataHash: HASH,
      review: { reviewer: 'Alice', reviewerWallet: SUB1, decision: 'requires_changes', complianceScore: 40, date: '2026-01-01T00:00:00Z' },
      receipt: await adapter.submitReview(SUB1, HASH, 'RequiresChanges', 40, 'c1'),
    });
    let cert = await Certificate.findOne({ metadataHash: HASH });
    expect(cert.reviews).toHaveLength(1);
    expect(cert.status).toBe('requires_changes');
    expect(cert.complianceScore).toBe(40);

    // SUB1 re-reviews approved (88) — overwrite, not append
    await indexer.mirrorReview({
      metadataHash: HASH,
      review: { reviewer: 'Alice', reviewerWallet: SUB1, decision: 'approved', complianceScore: 88, date: '2026-02-01T00:00:00Z' },
      receipt: await adapter.submitReview(SUB1, HASH, 'Approved', 88, 'c2'),
    });
    cert = await Certificate.findOne({ metadataHash: HASH });
    expect(cert.reviews).toHaveLength(1);
    expect(cert.status).toBe('approved');
    expect(cert.complianceScore).toBe(88);

    // SUB2 reviews later with approved_with_recommendations (72) — latest wins overall
    await indexer.mirrorReview({
      metadataHash: HASH,
      review: { reviewer: 'Bob', reviewerWallet: SUB2, decision: 'approved_with_recommendations', complianceScore: 72, date: '2026-03-01T00:00:00Z' },
      receipt: await adapter.submitReview(SUB2, HASH, 'ApprovedWithRecommendations', 72, 'c3'),
    });
    cert = await Certificate.findOne({ metadataHash: HASH });
    expect(cert.reviews).toHaveLength(2);
    expect(cert.status).toBe('approved_with_recommendations');
    expect(cert.complianceScore).toBe(72);
  });
});

describe('mirror issue / revoke', () => {
  beforeEach(async () => {
    await adapter.storeDocument(COMP, 'Report.pdf', HASH);
    await indexer.mirrorStoredDocument({ metadataHash: HASH, certificateName: 'Report.pdf', subject: 'ISO-27001' });
  });

  it('issue -> status issued + expiryAt set; revoke -> status revoked', async () => {
    const expiryUnix = 4_000_000_000;
    const issueReceipt = await adapter.issueCertificate(ADMIN, HASH, expiryUnix);
    let cert = await indexer.mirrorIssuedCertificate({ metadataHash: HASH, expiryUnix, receipt: issueReceipt });
    expect(cert.status).toBe('issued');
    expect(cert.chain.certificateStatus).toBe('Issued');
    expect(cert.chain.txHashIssue).toBe(issueReceipt.hash);
    expect(new Date(cert.expiryAt).getTime()).toBe(expiryUnix * 1000);

    const revokeReceipt = { hash: 'stub-revoke-1', source: 'stub', status: 'simulated' };
    cert = await indexer.mirrorRevocation({ metadataHash: HASH, receipt: revokeReceipt });
    expect(cert.status).toBe('revoked');
    expect(cert.chain.certificateStatus).toBe('Revoked');
    expect(cert.chain.txHashRevoke).toBe('stub-revoke-1');
  });
});

describe('mirror company / sub-admin activation', () => {
  it('whitelist -> company active; add_sub_admin -> sub-admin active', async () => {
    const company = await Company.create({ name: 'Acme', status: 'pending' });
    const sa = await SubAdmin.create({ name: 'Alice', email: 'a@x.io', status: 'invited' });

    const c = await indexer.mirrorCompanyApproved({ companyId: company._id, receipt: { hash: 'wl-1' } });
    expect(c.status).toBe('active');
    expect(c.txHashWhitelist).toBe('wl-1');

    const s = await indexer.mirrorSubAdminActivated({ subAdminId: sa._id, receipt: { hash: 'sa-1' } });
    expect(s.status).toBe('active');
    expect(s.txHashAdd).toBe('sa-1');
  });
});
