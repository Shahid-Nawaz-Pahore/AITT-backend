// __tests__/document.lifecycle.int.test.js
// P3 end-to-end at the service layer against in-memory Mongo + a shared stub
// adapter: register -> approve -> invite -> activate -> submit -> review -> issue
// -> verify, plus enforcement of gaps #2/#3/#4/#6 and the whitelist/role gates.
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Company = require('../src/models/Company');
const SubAdmin = require('../src/models/SubAdmin');
const User = require('../src/models/User');
const Certificate = require('../src/models/Certificate');
const Web3Tx = require('../src/models/Web3Tx');

const companyService = require('../src/services/company.service');
const subadminService = require('../src/services/subadmin.service');
const documentService = require('../src/services/document.service');
const { createStubAdapter } = require('../src/services/sorobanAdapter/stub');

let mongoServer;
let adapter;

const fileBuf = (s = 'hello-doc') => Buffer.from(s);

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
  adapter = createStubAdapter(); // shared across every service call in a test
});

// Helpers that drive the full setup and return the ids the services need.
async function setupCompany({ approve = true } = {}) {
  const registered = await companyService.registerCompany({ name: 'Acme', email: 'admin@acme.io', password: 'Passw0rd' });
  const company = approve ? await companyService.approveCompany(registered.id, { adapter }) : registered;
  const adminUser = await User.findOne({ companyId: registered.id });
  return { company, adminUser };
}
async function setupSubAdmin({ activate = true, email = 'rev@x.io' } = {}) {
  const sa = await subadminService.inviteSubAdmin({ name: 'Reviewer', email });
  if (activate) await subadminService.activateSubAdmin(sa.id, { adapter });
  const user = await User.findOne({ subAdminId: sa.id });
  return { subAdmin: sa, user };
}
async function submit(companyId, requestedByUserId, content = 'doc') {
  return documentService.submitDocument({
    buffer: fileBuf(content), filename: 'report.pdf', subject: 'ISO-27001',
    mimeType: 'application/pdf', size: 10, companyId, requestedByUserId, adapter,
  });
}

describe('golden path: register → approve → invite → activate → submit → review → issue → verify', () => {
  it('walks the full lifecycle and lands issued + verified', async () => {
    const { company, adminUser } = await setupCompany();
    expect(company.status).toBe('active');

    const { user: reviewerUser } = await setupSubAdmin();

    const doc = await submit(company.id, adminUser._id);
    expect(doc.status).toBe('submitted');
    expect(doc.company).toBe('Acme');
    expect(doc.hash).toMatch(/^[a-f0-9]{64}$/);

    const reviewed = await documentService.reviewDocument({
      id: doc.id, reviewerUserId: reviewerUser._id, decision: 'approved', complianceScore: 92, comment: 'LGTM', adapter,
    });
    expect(reviewed.status).toBe('approved');
    expect(reviewed.complianceScore).toBe(92);
    expect(reviewed.reviews).toHaveLength(1);
    expect(reviewed.reviews[0]).toMatchObject({ reviewer: 'Reviewer', decision: 'approved', complianceScore: 92 });

    const issued = await documentService.issueDocument({ id: doc.id, issuerUserId: adminUser._id, adapter });
    expect(issued.status).toBe('issued');
    expect(issued.expiryAt).toBeDefined();

    const verify = await documentService.verifyDocument({ hashOrId: doc.hash, adapter });
    expect(verify.verified).toBe(true);
    expect(verify.certificateStatus).toBe('Issued');

    // Audit rows persisted (store + whitelist + add_sub_admin + review + issue).
    const purposes = (await Web3Tx.find({}).lean()).map((t) => t.purpose).sort();
    expect(purposes).toEqual(expect.arrayContaining(['add_sub_admin', 'issue', 'review', 'store', 'whitelist']));
  });
});

describe('gap #2 — review-before-issue gate', () => {
  it('blocks issue with no review', async () => {
    const { company, adminUser } = await setupCompany();
    const doc = await submit(company.id, adminUser._id);
    await expect(documentService.issueDocument({ id: doc.id, issuerUserId: adminUser._id, adapter }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('blocks issue when latest review is requires_changes or rejected', async () => {
    const { company, adminUser } = await setupCompany();
    const { user } = await setupSubAdmin();
    const doc = await submit(company.id, adminUser._id);

    await documentService.reviewDocument({ id: doc.id, reviewerUserId: user._id, decision: 'requires_changes', complianceScore: 40, adapter });
    await expect(documentService.issueDocument({ id: doc.id, issuerUserId: adminUser._id, adapter }))
      .rejects.toMatchObject({ statusCode: 409 });

    await documentService.reviewDocument({ id: doc.id, reviewerUserId: user._id, decision: 'rejected', complianceScore: 10, adapter });
    await expect(documentService.issueDocument({ id: doc.id, issuerUserId: adminUser._id, adapter }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('allows issue after approved_with_recommendations', async () => {
    const { company, adminUser } = await setupCompany();
    const { user } = await setupSubAdmin();
    const doc = await submit(company.id, adminUser._id);
    await documentService.reviewDocument({ id: doc.id, reviewerUserId: user._id, decision: 'approved_with_recommendations', complianceScore: 75, adapter });
    const issued = await documentService.issueDocument({ id: doc.id, issuerUserId: adminUser._id, adapter });
    expect(issued.status).toBe('issued');
  });
});

describe('gap #3 — server-side 0–100 score validation', () => {
  it('rejects out-of-range / non-numeric scores', async () => {
    const { company, adminUser } = await setupCompany();
    const { user } = await setupSubAdmin();
    const doc = await submit(company.id, adminUser._id);

    for (const bad of [150, -5, 'abc', null, NaN]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(documentService.reviewDocument({ id: doc.id, reviewerUserId: user._id, decision: 'approved', complianceScore: bad, adapter }))
        .rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it('rejects an unknown decision', async () => {
    const { company, adminUser } = await setupCompany();
    const { user } = await setupSubAdmin();
    const doc = await submit(company.id, adminUser._id);
    await expect(documentService.reviewDocument({ id: doc.id, reviewerUserId: user._id, decision: 'maybe', complianceScore: 50, adapter }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('gap #6 — one review per officer; gap #4 — overall score latest-wins', () => {
  it('same officer overwrites (no duplicate) and reviewsDone counts once', async () => {
    const { company, adminUser } = await setupCompany();
    const { subAdmin, user } = await setupSubAdmin();
    const doc = await submit(company.id, adminUser._id);

    await documentService.reviewDocument({ id: doc.id, reviewerUserId: user._id, decision: 'requires_changes', complianceScore: 30, adapter });
    const second = await documentService.reviewDocument({ id: doc.id, reviewerUserId: user._id, decision: 'approved', complianceScore: 88, adapter });

    expect(second.reviews).toHaveLength(1);
    expect(second.status).toBe('approved');
    expect(second.complianceScore).toBe(88);

    const saDoc = await SubAdmin.findById(subAdmin.id);
    expect(saDoc.reviewsDone).toBe(1); // counted once despite two submissions
  });

  it('overall score follows the most recent reviewer', async () => {
    const { company, adminUser } = await setupCompany();
    const a = await setupSubAdmin({ email: 'a@x.io' });
    const b = await setupSubAdmin({ email: 'b@x.io' });
    const doc = await submit(company.id, adminUser._id);

    await documentService.reviewDocument({ id: doc.id, reviewerUserId: a.user._id, decision: 'approved', complianceScore: 95, adapter });
    const latest = await documentService.reviewDocument({ id: doc.id, reviewerUserId: b.user._id, decision: 'approved_with_recommendations', complianceScore: 70, adapter });

    expect(latest.reviews).toHaveLength(2);
    expect(latest.complianceScore).toBe(70);
    expect(latest.status).toBe('approved_with_recommendations');
  });
});

describe('access / lifecycle guards', () => {
  it('a PENDING (unapproved) company cannot submit documents', async () => {
    const { company, adminUser } = await setupCompany({ approve: false });
    await expect(submit(company.id, adminUser._id)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('an invited-but-not-activated sub-admin cannot review', async () => {
    const { company, adminUser } = await setupCompany();
    const { user } = await setupSubAdmin({ activate: false });
    const doc = await submit(company.id, adminUser._id);
    await expect(documentService.reviewDocument({ id: doc.id, reviewerUserId: user._id, decision: 'approved', complianceScore: 80, adapter }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects a duplicate content hash on submit', async () => {
    const { company, adminUser } = await setupCompany();
    await submit(company.id, adminUser._id, 'same');
    await expect(submit(company.id, adminUser._id, 'same')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('list is role-scoped: company admin sees only its own company docs', async () => {
    const { company, adminUser } = await setupCompany();
    await submit(company.id, adminUser._id, 'one');

    const asCompany = await documentService.listDocuments({ user: { role: 'company_admin', companyId: company.id }, page: 1, limit: 10 });
    expect(asCompany.total).toBe(1);

    const otherCompany = await documentService.listDocuments({ user: { role: 'company_admin', companyId: new mongoose.Types.ObjectId() }, page: 1, limit: 10 });
    expect(otherCompany.total).toBe(0);

    const asAdmin = await documentService.listDocuments({ user: { role: 'super_admin' }, page: 1, limit: 10 });
    expect(asAdmin.total).toBe(1);
  });
});

describe('serialization matches frontend shapes', () => {
  it('registerCompany returns a frontend Company; invite returns a frontend SubAdmin', async () => {
    const c = await companyService.registerCompany({ name: 'Beta', email: 'b@beta.io' });
    expect(c).toMatchObject({ name: 'Beta', email: 'b@beta.io', status: 'pending', documents: 0 });
    expect(typeof c.wallet).toBe('string');
    expect(c.joinedAt).toBeDefined();

    const sa = await subadminService.inviteSubAdmin({ name: 'Sub', email: 'sub@x.io' });
    expect(sa).toMatchObject({ name: 'Sub', email: 'sub@x.io', reviewsDone: 0, status: 'invited' });
    expect(typeof sa.wallet).toBe('string');

    // Custodial secret is never serialized.
    expect(sa).not.toHaveProperty('walletSecretEnc');
  });
});
