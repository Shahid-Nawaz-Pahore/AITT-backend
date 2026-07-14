// __tests__/governance.int.test.js
// P4 multi-sig governance at the service layer (in-memory Mongo + shared stub).
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../src/models/User');
const Certificate = require('../src/models/Certificate');
const Framework = require('../src/models/Framework');
const Web3Tx = require('../src/models/Web3Tx');

const companyService = require('../src/services/company.service');
const subadminService = require('../src/services/subadmin.service');
const documentService = require('../src/services/document.service');
const governanceService = require('../src/services/governance.service');
const proposalService = require('../src/services/proposal.service');
const { createStubAdapter } = require('../src/services/sorobanAdapter/stub');

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
  adapter = createStubAdapter();
});

async function makeAdmin() {
  return User.create({ email: 'admin@aitt.io', role: 'super_admin' });
}
async function makeActiveSub(email) {
  const sa = await subadminService.inviteSubAdmin({ name: `Sub ${email}`, email });
  await subadminService.activateSubAdmin(sa.id, { adapter });
  const user = await User.findOne({ subAdminId: sa.id });
  return { sa, user };
}
async function makeIssuedDoc() {
  const reg = await companyService.registerCompany({ name: 'Acme', email: 'co@acme.io' });
  await companyService.approveCompany(reg.id, { adapter });
  const adminUser = await User.findOne({ companyId: reg.id });
  const reviewer = await makeActiveSub('rev@x.io');
  const doc = await documentService.submitDocument({
    buffer: Buffer.from('govdoc'), filename: 'r.pdf', subject: 'ISO', companyId: reg.id, requestedByUserId: adminUser._id, adapter,
  });
  await documentService.reviewDocument({ id: doc.id, reviewerUserId: reviewer.user._id, decision: 'approved', complianceScore: 90, adapter });
  await documentService.issueDocument({ id: doc.id, issuerUserId: adminUser._id, adapter });
  return { doc, reviewer };
}

describe('revocation proposal — create → sign to threshold → auto-execute → cert revoked', () => {
  it('walks the full 2-of-2 flow', async () => {
    const admin = await makeAdmin();
    const { doc, reviewer } = await makeIssuedDoc();          // reviewer is sub #1 (active)
    const sub2 = await makeActiveSub('rev2@x.io');             // sub #2 (active)
    await governanceService.setGovernance({ required: 2, adminUserId: admin._id, adapter }); // N=2, M=2

    // CREATE — starts with 0 approvals (creating != signing).
    const created = await proposalService.createProposal({
      type: 'revocation', title: 'Revoke Acme cert', description: 'breach', targetRef: doc.id, creatorUserId: admin._id, adapter,
    });
    expect(created.proposal.status).toBe('pending');
    expect(created.proposal.approvals).toBe(0);
    expect(created.proposal.signers).toEqual([]);
    expect(created.note).toMatch(/0 approvals/i);

    // SIGN #1 (reviewer/sub1) — 1/2, not executed; cert still issued.
    const afterOne = await proposalService.signProposal({ id: created.proposal.id, signerUserId: reviewer.user._id, adapter });
    expect(afterOne.approvals).toBe(1);
    expect(afterOne.status).toBe('pending');
    expect((await Certificate.findById(doc.id)).status).toBe('issued');

    // SIGN #2 (sub2) — 2/2 -> auto-execute -> cert revoked, signers mapped from chain.
    const afterTwo = await proposalService.signProposal({ id: created.proposal.id, signerUserId: sub2.user._id, adapter });
    expect(afterTwo.status).toBe('executed');
    expect(afterTwo.approvals).toBe(2);
    expect(afterTwo.signers).toHaveLength(2);

    const cert = await Certificate.findById(doc.id);
    expect(cert.status).toBe('revoked');
    expect(cert.chain.certificateStatus).toBe('Revoked');
  });

  it('double-sign by the same officer is rejected', async () => {
    const admin = await makeAdmin();
    const { doc, reviewer } = await makeIssuedDoc();
    await makeActiveSub('rev2@x.io');
    await governanceService.setGovernance({ required: 2, adminUserId: admin._id, adapter });

    const created = await proposalService.createProposal({ type: 'revocation', title: 'r', targetRef: doc.id, creatorUserId: admin._id, adapter });
    await proposalService.signProposal({ id: created.proposal.id, signerUserId: reviewer.user._id, adapter });
    await expect(proposalService.signProposal({ id: created.proposal.id, signerUserId: reviewer.user._id, adapter }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('a non-sub-admin (company admin) cannot sign', async () => {
    const admin = await makeAdmin();
    const { doc } = await makeIssuedDoc();
    await makeActiveSub('rev2@x.io');
    await governanceService.setGovernance({ required: 2, adminUserId: admin._id, adapter });
    const created = await proposalService.createProposal({ type: 'revocation', title: 'r', targetRef: doc.id, creatorUserId: admin._id, adapter });

    const companyUser = await User.findOne({ role: 'company_admin' });
    await expect(proposalService.signProposal({ id: created.proposal.id, signerUserId: companyUser._id, adapter }))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('governance_rule proposal — UpdateThreshold via multi-sig', () => {
  it('executes and the DB threshold follows the chain', async () => {
    const admin = await makeAdmin();
    await makeActiveSub('a@x.io');
    await makeActiveSub('b@x.io'); // M = 2, threshold stays 1 (default) -> single sign auto-executes
    const { user: signer } = await makeActiveSub('c@x.io');

    const created = await proposalService.createProposal({
      type: 'governance_rule', title: 'Raise to 2', payload: { value: 2 }, creatorUserId: admin._id, adapter,
    });
    const signed = await proposalService.signProposal({ id: created.proposal.id, signerUserId: signer._id, adapter });
    expect(signed.status).toBe('executed');

    const gov = await governanceService.getGovernance({ adapter });
    expect(gov.required).toBe(2);
  });
});

describe('framework_update — BACKEND-ONLY governance (gap #1)', () => {
  it('never touches the chain and applies the framework change at threshold', async () => {
    const admin = await makeAdmin();
    const s1 = await makeActiveSub('a@x.io');
    const s2 = await makeActiveSub('b@x.io');
    await governanceService.setGovernance({ required: 2, adminUserId: admin._id, adapter });

    const created = await proposalService.createProposal({
      type: 'framework_update', title: 'Add GDPR', payload: { action: 'create', name: 'GDPR', description: 'EU privacy' }, creatorUserId: admin._id, adapter,
    });
    expect(created.note).toMatch(/off-chain/i);

    await proposalService.signProposal({ id: created.proposal.id, signerUserId: s1.user._id, adapter });
    let frameworks = await Framework.find({ name: 'GDPR' });
    expect(frameworks).toHaveLength(0); // 1/2 — not applied yet

    const done = await proposalService.signProposal({ id: created.proposal.id, signerUserId: s2.user._id, adapter });
    expect(done.status).toBe('executed');
    frameworks = await Framework.find({ name: 'GDPR' });
    expect(frameworks).toHaveLength(1);

    // No on-chain create/approve tx were recorded for the framework_update proposal.
    const govTx = await Web3Tx.find({ purpose: { $in: ['create_proposal', 'approve_proposal'] } });
    expect(govTx).toHaveLength(0);
  });
});

describe('governance settings (N ≤ M) and reject', () => {
  it('rejects N > M', async () => {
    const admin = await makeAdmin();
    await makeActiveSub('a@x.io');
    await makeActiveSub('b@x.io'); // M = 2
    await expect(governanceService.setGovernance({ required: 5, adminUserId: admin._id, adapter }))
      .rejects.toMatchObject({ statusCode: 400 });
    const ok = await governanceService.setGovernance({ required: 2, adminUserId: admin._id, adapter });
    expect(ok.required).toBe(2);
    expect(ok.total).toBe(2);
    expect(ok.signerWallets).toHaveLength(2);
  });

  it('reject sets a backend-only rejected status and blocks further signing', async () => {
    const admin = await makeAdmin();
    const { doc, reviewer } = await makeIssuedDoc();
    await makeActiveSub('rev2@x.io');
    await governanceService.setGovernance({ required: 2, adminUserId: admin._id, adapter });
    const created = await proposalService.createProposal({ type: 'revocation', title: 'r', targetRef: doc.id, creatorUserId: admin._id, adapter });

    const rejected = await proposalService.rejectProposal({ id: created.proposal.id, adminUserId: admin._id });
    expect(rejected.status).toBe('rejected');
    await expect(proposalService.signProposal({ id: created.proposal.id, signerUserId: reviewer.user._id, adapter }))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});
