// __tests__/models.p1.int.test.js
// Integration tests (mongodb-memory-server) for the P1 model extensions, the
// new collections, and the P1 data migration. No chain / services touched.
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../src/models/User');
const Company = require('../src/models/Company');
const Certificate = require('../src/models/Certificate');
const SubAdmin = require('../src/models/SubAdmin');
const Proposal = require('../src/models/Proposal');
const GovernanceConfig = require('../src/models/GovernanceConfig');
const Framework = require('../src/models/Framework');
const Template = require('../src/models/Template');
const Alert = require('../src/models/Alert');
const { runP1Migration } = require('../src/migrations/migrate-p1');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'testdb' });
  // Ensure unique indexes are built before duplicate-key assertions.
  await Promise.all([
    Certificate.init(),
    SubAdmin.init(),
    GovernanceConfig.init(),
  ]);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongoServer) await mongoServer.stop();
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

describe('User — sub_admin role + subAdminId', () => {
  it('accepts the new sub_admin role', async () => {
    const u = await User.create({ email: 'r@x.io', role: 'sub_admin' });
    expect(u.role).toBe('sub_admin');
  });

  it('keeps regulator_admin as a (deprecated) valid value', async () => {
    const u = await User.create({ email: 'r2@x.io', role: 'regulator_admin' });
    expect(u.role).toBe('regulator_admin');
  });

  it('rejects an unknown role', async () => {
    await expect(User.create({ email: 'r3@x.io', role: 'wizard' })).rejects.toThrow();
  });

  it('can link a SubAdmin profile via subAdminId', async () => {
    const sa = await SubAdmin.create({ name: 'Rev', email: 'rev@x.io' });
    const u = await User.create({ email: 'rev-login@x.io', role: 'sub_admin', subAdminId: sa._id });
    expect(String(u.subAdminId)).toBe(String(sa._id));
  });
});

describe('Company — status pending/active', () => {
  it('defaults new companies to pending', async () => {
    const c = await Company.create({ name: 'Acme' });
    expect(c.status).toBe('pending');
  });

  it('rejects an invalid status', async () => {
    await expect(Company.create({ name: 'Bad', status: 'frozen' })).rejects.toThrow();
  });
});

describe('Certificate — 9-status, reviews, complianceScore, unique hash', () => {
  it('defaults status to submitted', async () => {
    const cert = await Certificate.create({ certificateName: 'C', subject: 'S', metadataHash: 'h1' });
    expect(cert.status).toBe('submitted');
  });

  it('accepts all 9 DocStatus values and rejects the removed "validated"', async () => {
    const ok = await Certificate.create({ certificateName: 'C', subject: 'S', metadataHash: 'h2', status: 'approved_with_recommendations' });
    expect(ok.status).toBe('approved_with_recommendations');
    await expect(
      Certificate.create({ certificateName: 'C', subject: 'S', metadataHash: 'h3', status: 'validated' }),
    ).rejects.toThrow();
  });

  it('enforces UNIQUE metadataHash', async () => {
    await Certificate.create({ certificateName: 'C', subject: 'S', metadataHash: 'dup' });
    await expect(
      Certificate.create({ certificateName: 'C2', subject: 'S2', metadataHash: 'dup' }),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('embeds reviews and validates decision + 0–100 score', async () => {
    const cert = await Certificate.create({
      certificateName: 'C', subject: 'S', metadataHash: 'h4',
      reviews: [{ reviewer: 'A', decision: 'approved', complianceScore: 91, comment: 'ok' }],
      complianceScore: 91,
    });
    expect(cert.reviews).toHaveLength(1);
    expect(cert.reviews[0].decision).toBe('approved');

    await expect(
      Certificate.create({
        certificateName: 'C', subject: 'S', metadataHash: 'h5',
        reviews: [{ reviewer: 'A', decision: 'approved', complianceScore: 150 }],
      }),
    ).rejects.toThrow();

    await expect(
      Certificate.create({
        certificateName: 'C', subject: 'S', metadataHash: 'h6',
        reviews: [{ reviewer: 'A', decision: 'not_a_decision', complianceScore: 50 }],
      }),
    ).rejects.toThrow();
  });

  it('persists chain txHash anchors (store/issue/review/revoke)', async () => {
    const cert = await Certificate.create({
      certificateName: 'C', subject: 'S', metadataHash: 'h7',
      chain: { certificateStatus: 'Issued', txHashStore: 'a', txHashIssue: 'b', txHashReview: 'c', txHashRevoke: 'd' },
    });
    expect(cert.chain.txHashStore).toBe('a');
    expect(cert.chain.certificateStatus).toBe('Issued');
  });
});

describe('SubAdmin / Framework / Template / Alert', () => {
  it('SubAdmin defaults: status invited, reviewsDone 0; email is unique', async () => {
    const sa = await SubAdmin.create({ name: 'Jo', email: 'jo@x.io' });
    expect(sa.status).toBe('invited');
    expect(sa.reviewsDone).toBe(0);
    await expect(SubAdmin.create({ name: 'Jo2', email: 'jo@x.io' })).rejects.toThrow(/duplicate key/i);
  });

  it('Framework requires a name', async () => {
    const f = await Framework.create({ name: 'GDPR', description: 'EU privacy' });
    expect(f.active).toBe(true);
    await expect(Framework.create({ description: 'no name' })).rejects.toThrow();
  });

  it('Template requires file', async () => {
    const t = await Template.create({ name: 'Policy', description: 'd', file: 'policy.docx' });
    expect(t.file).toBe('policy.docx');
    await expect(Template.create({ name: 'NoFile', description: 'd' })).rejects.toThrow();
  });

  it('Alert enforces severity enum and defaults resolved=false', async () => {
    const cert = await Certificate.create({ certificateName: 'C', subject: 'S', metadataHash: 'h8' });
    const a = await Alert.create({ docId: cert._id, message: 'expiring', dueDate: new Date(), severity: 'critical' });
    expect(a.resolved).toBe(false);
    await expect(Alert.create({ docId: cert._id, message: 'x', dueDate: new Date(), severity: 'boom' })).rejects.toThrow();
  });
});

describe('Proposal — types/status enums + defaults', () => {
  it('accepts the 4 proposal types and defaults to pending', async () => {
    const p = await Proposal.create({ type: 'framework_update', title: 'Update GDPR', threshold: 2 });
    expect(p.status).toBe('pending');
    expect(p.signers).toEqual([]);
    expect(p.onChain).toBe(true);
  });

  it('rejects an unknown type', async () => {
    await expect(Proposal.create({ type: 'mint_nft', title: 'x', threshold: 1 })).rejects.toThrow();
  });

  it('exposes on/off-chain type partitions as statics', () => {
    expect(Proposal.OFFCHAIN_PROPOSAL_TYPES).toEqual(['framework_update']);
    expect(Proposal.ONCHAIN_PROPOSAL_TYPES).toEqual(expect.arrayContaining(['revocation', 'governance_rule', 'contract_upgrade']));
  });
});

describe('GovernanceConfig — singleton + N<=M', () => {
  it('getSingleton creates and reuses one config', async () => {
    const a = await GovernanceConfig.getSingleton();
    const b = await GovernanceConfig.getSingleton();
    expect(String(a._id)).toBe(String(b._id));
    expect(a.required).toBe(1);
    expect(a.total).toBe(1);
  });

  it('rejects required (N) > total (M)', async () => {
    await expect(GovernanceConfig.create({ key: 'g2', required: 5, total: 3 })).rejects.toThrow(/cannot exceed/i);
  });
});

describe('runP1Migration() — idempotent backfill/convert/migrate', () => {
  beforeEach(async () => {
    // Insert LEGACY raw docs that bypass the post-P1 validators.
    await Company.collection.insertOne({ name: 'Legacy Co' }); // no status field
    await Company.collection.insertOne({ name: 'Pending Co', status: 'pending' });
    await User.collection.insertOne({ email: 'leg@x.io', role: 'regulator_admin' });
    await Certificate.collection.insertMany([
      { certificateName: 'L1', subject: 'S', metadataHash: 'm1', status: 'requested' },
      { certificateName: 'L2', subject: 'S', metadataHash: 'm2', status: 'validated' },
      { certificateName: 'L3', subject: 'S', metadataHash: 'm3', status: 'issued' },
    ]);
  });

  it('backfills missing company status -> active (leaves explicit pending alone)', async () => {
    const report = await runP1Migration();
    expect(report.companyStatus.modified).toBe(1);
    expect(await Company.collection.findOne({ name: 'Legacy Co' })).toMatchObject({ status: 'active' });
    expect(await Company.collection.findOne({ name: 'Pending Co' })).toMatchObject({ status: 'pending' });
  });

  it('converts regulator_admin -> sub_admin', async () => {
    await runP1Migration();
    expect(await User.collection.findOne({ email: 'leg@x.io' })).toMatchObject({ role: 'sub_admin' });
  });

  it('migrates legacy certificate statuses (requested->submitted, validated->issued)', async () => {
    await runP1Migration();
    expect(await Certificate.collection.findOne({ metadataHash: 'm1' })).toMatchObject({ status: 'submitted' });
    expect(await Certificate.collection.findOne({ metadataHash: 'm2' })).toMatchObject({ status: 'issued' });
    expect(await Certificate.collection.findOne({ metadataHash: 'm3' })).toMatchObject({ status: 'issued' });
  });

  it('is idempotent — a second run modifies nothing', async () => {
    await runP1Migration();
    const second = await runP1Migration();
    expect(second.companyStatus.modified).toBe(0);
    expect(second.roleConversion.modified).toBe(0);
    expect(second.certificateStatus.requested.modified).toBe(0);
  });

  it('--no-roles (convertRoles=false) skips role conversion', async () => {
    const report = await runP1Migration({ convertRoles: false });
    expect(report.roleConversion).toMatchObject({ skipped: expect.any(String) });
    expect(await User.collection.findOne({ email: 'leg@x.io' })).toMatchObject({ role: 'regulator_admin' });
  });
});
