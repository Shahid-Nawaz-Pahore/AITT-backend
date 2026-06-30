// __tests__/reconcile.int.test.js
// chain <-> DB reconcile against an in-memory Mongo + the stub adapter.
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Certificate = require('../src/models/Certificate');
const GovernanceConfig = require('../src/models/GovernanceConfig');
const { createStubAdapter } = require('../src/services/sorobanAdapter/stub');
const reconcile = require('../src/services/reconcile.service');

const ADMIN = 'GADMIN0000000000000000000000000000000000000000000000000';
const SUB1 = 'GSUB10000000000000000000000000000000000000000000000000';
const COMP = 'GCOMP0000000000000000000000000000000000000000000000000';
const HASH = 'c'.repeat(64);

let mongoServer;

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
});

describe('reconcileCertificate', () => {
  it('detects drift when the chain has revoked a cert the DB still shows issued, and fixes it', async () => {
    const adapter = createStubAdapter({ mainAdmin: ADMIN, threshold: 1 });
    await adapter.addSubAdmin(ADMIN, SUB1);
    await adapter.whitelistAddress(COMP);
    await adapter.storeDocument(COMP, 'Report.pdf', HASH);
    await adapter.issueCertificate(ADMIN, HASH, 9_000_000_000);

    // DB is stale: shows the cert as still issued.
    await Certificate.create({
      certificateName: 'Report.pdf', subject: 'ISO', metadataHash: HASH,
      status: 'issued', chain: { certificateStatus: 'Issued' }, expiryAt: new Date(9_000_000_000 * 1000),
    });

    // Chain revokes via a passing proposal.
    const { proposalId } = await adapter.createProposal(SUB1, { type: 'RevokeCertificate', docHash: HASH });
    await adapter.approveProposal(SUB1, proposalId);

    // Report-only first.
    let r = await reconcile.reconcileCertificate(HASH, { adapter, fix: false });
    expect(r.inSync).toBe(false);
    expect(r.drift.certificateStatus).toEqual({ db: 'Issued', chain: 'Revoked' });
    expect(r.drift.status).toEqual({ db: 'issued', expected: 'revoked' });
    expect(r.fixed).toBe(false);

    // Now fix.
    r = await reconcile.reconcileCertificate(HASH, { adapter, fix: true });
    expect(r.fixed).toBe(true);
    const cert = await Certificate.findOne({ metadataHash: HASH });
    expect(cert.status).toBe('revoked');
    expect(cert.chain.certificateStatus).toBe('Revoked');
  });

  it('reports missing sides (chain-only / db-only)', async () => {
    const adapter = createStubAdapter({ mainAdmin: ADMIN });
    // Neither side has it.
    let r = await reconcile.reconcileCertificate(HASH, { adapter });
    expect(r.inSync).toBe(false);
    expect(r.drift.missing).toBe('both');

    // DB-only.
    await Certificate.create({ certificateName: 'x', subject: 'y', metadataHash: HASH, status: 'submitted' });
    r = await reconcile.reconcileCertificate(HASH, { adapter });
    expect(r.drift.missing).toBe('chain');
  });

  it('reconcileAllCertificates summarizes drift across the collection', async () => {
    const adapter = createStubAdapter({ mainAdmin: ADMIN });
    await adapter.whitelistAddress(COMP);
    await adapter.storeDocument(COMP, 'a.pdf', HASH);
    // in-sync cert
    await Certificate.create({ certificateName: 'a', subject: 's', metadataHash: HASH, status: 'submitted', chain: { certificateStatus: 'Submitted' } });
    // drifted cert (db-only)
    await Certificate.create({ certificateName: 'b', subject: 's', metadataHash: 'd'.repeat(64), status: 'submitted' });

    const summary = await reconcile.reconcileAllCertificates({ adapter, fix: false });
    expect(summary.total).toBe(2);
    expect(summary.inSync).toBe(1);
    expect(summary.drifted).toBe(1);
  });
});

describe('reconcileGovernance', () => {
  it('detects + fixes threshold drift between DB and chain', async () => {
    const adapter = createStubAdapter({ mainAdmin: ADMIN, threshold: 3 });
    await GovernanceConfig.create({ key: 'global', required: 1, total: 5 });

    let r = await reconcile.reconcileGovernance({ adapter, fix: false });
    expect(r).toMatchObject({ chainThreshold: 3, dbRequired: 1, inSync: false, fixed: false });

    r = await reconcile.reconcileGovernance({ adapter, fix: true });
    expect(r.fixed).toBe(true);
    const cfg = await GovernanceConfig.getSingleton();
    expect(cfg.required).toBe(3);
  });
});
