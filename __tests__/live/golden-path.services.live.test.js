// __tests__/live/golden-path.services.live.test.js
// ---------------------------------------------------------------------------
// I3 — the FULL golden path through the SERVICE layer (not just the adapter),
// against the deployed contract, with the indexer mirroring chain state into a
// real (in-memory) Mongo. Proves:
//   * a brand-new custodial company wallet is friendbot-funded and can transact
//     on the real chain (B5 — the unfunded-wallet gap is closed);
//   * onboarding → submit → review → issue → verify → revoke-proposal → sign →
//     auto-execute all drive the real contract AND land correctly in Mongo;
//   * services consume readProposal().action as the { type, ... } stub shape.
//
// Signers: the two existing on-chain sub-admins (wallet-02/03) are seeded as
// active SubAdmin profiles so the service layer can sign submit_review /
// approve_proposal with their custodial keys. Uses fresh doc hashes per run and
// tolerates the shared contract's pre-existing state. NEVER calls
// transfer_main_admin. Runs only under `npm run test:live`.
// ---------------------------------------------------------------------------
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { liveDescribe, resetRpc, wallets, pub, sec } = require('./_liveEnv');

// Env needed by the services under real mode (set BEFORE requiring them).
process.env.AUTO_FUND_WALLETS = 'true';
process.env.KEY_ENCRYPTION_SECRET = process.env.KEY_ENCRYPTION_SECRET || 'live-golden-path-encryption-key';

const { realAdapter } = require('../../src/services/sorobanAdapter/real');
const { encryptSecret } = require('../../src/utils/wallet');
const companyService = require('../../src/services/company.service');
const documentService = require('../../src/services/document.service');
const proposalService = require('../../src/services/proposal.service');
const governanceService = require('../../src/services/governance.service');
const User = require('../../src/models/User');
const SubAdmin = require('../../src/models/SubAdmin');
const Proposal = require('../../src/models/Proposal');
const Certificate = require('../../src/models/Certificate');
const Web3Tx = require('../../src/models/Web3Tx');
const GovernanceConfig = require('../../src/models/GovernanceConfig');

const T = 170000; // per-step timeout (live txs)

liveDescribe('I3 — golden path through services (live + Mongo mirror)', () => {
  let mongoServer;
  const adapter = realAdapter;
  const state = {};
  const txlog = [];

  // Seed an active SubAdmin + login for an existing on-chain sub-admin wallet.
  async function seedSubAdmin(wallet, name, email) {
    const sa = await SubAdmin.create({
      name, email, walletAddress: pub(wallet), walletSecretEnc: encryptSecret(sec(wallet)),
      status: 'active', reviewsDone: 0,
    });
    const user = await User.create({ email, role: 'sub_admin', subAdminId: sa._id, walletAddress: pub(wallet) });
    return { sa, user };
  }

  beforeAll(async () => {
    resetRpc();
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri(), { dbName: 'i3live' });

    // Ensure deterministic chain governance: wallet-02/03 are sub-admins, N=2.
    const admin = pub(wallets.mainAdmin);
    await adapter.addSubAdmin(admin, pub(wallets.subAdminA)).catch(() => {});
    await adapter.addSubAdmin(admin, pub(wallets.subAdminB)).catch(() => {});
    await adapter.setThreshold(admin, 2).catch(() => {});

    state.super = await User.create({ email: 'super@aitt.io', role: 'super_admin' });
    state.rev1 = await seedSubAdmin(wallets.subAdminA, 'Reviewer A', 'reva@aitt.io');
    state.rev2 = await seedSubAdmin(wallets.subAdminB, 'Reviewer B', 'revb@aitt.io');

    const cfg = await GovernanceConfig.getSingleton();
    cfg.required = 2; cfg.total = 2; await cfg.save();
  }, T);

  afterAll(async () => {
    // eslint-disable-next-line no-console
    if (txlog.length) console.log('\n=== I3 live golden-path tx hashes ===\n' + txlog.join('\n') + '\n');
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    if (mongoServer) await mongoServer.stop();
  }, T);

  it('registers a company (fresh custodial wallet, pending)', async () => {
    const reg = await companyService.registerCompany({ name: 'GoldenPath Co', email: `gp${Date.now()}@x.io` });
    expect(reg.id).toBeTruthy();
    state.companyId = reg.id;
  }, T);

  it('approves the company — funds the fresh wallet (friendbot) + whitelists it on-chain', async () => {
    const c = await companyService.approveCompany(state.companyId, { adapter });
    expect(c.status).toBe('active');
    const company = await require('../../src/models/Company').findById(state.companyId);
    expect(company.txHashWhitelist).toBeTruthy();
    txlog.push(`whitelist: ${company.txHashWhitelist}`);
    // The fresh wallet now exists on-chain and is whitelisted.
    expect(await adapter.isWhitelisted(company.walletAddress)).toBe(true);
  }, T);

  it('submits a document — the FUNDED fresh company wallet signs store_document', async () => {
    const admin = await User.findOne({ companyId: state.companyId, role: 'company_admin' });
    const buffer = Buffer.from(`golden-path-doc-${Date.now()}-${Math.round(process.hrtime()[1])}`);
    const doc = await documentService.submitDocument({
      buffer, filename: 'GoldenPath.pdf', subject: 'ISO-27001',
      companyId: state.companyId, requestedByUserId: admin._id, adapter,
    });
    expect(doc.status).toBe('submitted');
    state.docId = doc.id;

    const cert = await Certificate.findById(doc.id);
    expect(cert.chain.txHashStore).toBeTruthy();
    txlog.push(`store_document: ${cert.chain.txHashStore}`);
    // The on-chain doc exists and was added_by the fresh (funded) company wallet.
    const company = await require('../../src/models/Company').findById(state.companyId);
    const onchain = await adapter.readDocument(cert.metadataHash);
    expect(onchain.status).toBe('Submitted');
    expect(onchain.added_by).toBe(company.walletAddress);
    // Web3Tx recorded as a real, confirmed tx.
    const storeTx = await Web3Tx.findOne({ purpose: 'store' }).sort({ createdAt: -1 });
    expect(storeTx.source).toBe('real');
    expect(storeTx.status).toBe('confirmed');
  }, T);

  it('reviews the document (sub-admin wallet-02 signs submit_review) → mirrored', async () => {
    const doc = await documentService.reviewDocument({
      id: state.docId, reviewerUserId: state.rev1.user._id,
      decision: 'approved', complianceScore: 91, comment: 'looks good', adapter,
    });
    expect(doc.status).toBe('approved');
    expect(doc.complianceScore).toBe(91);
    const cert = await Certificate.findById(state.docId);
    expect(cert.chain.txHashReview).toBeTruthy();
    txlog.push(`submit_review: ${cert.chain.txHashReview}`);
  }, T);

  it('issues the certificate (main admin signs issue_certificate) → Issued + verified', async () => {
    const doc = await documentService.issueDocument({ id: state.docId, issuerUserId: state.super._id, adapter });
    expect(doc.status).toBe('issued');
    const cert = await Certificate.findById(state.docId);
    expect(cert.chain.certificateStatus).toBe('Issued');
    expect(cert.chain.txHashIssue).toBeTruthy();
    txlog.push(`issue_certificate: ${cert.chain.txHashIssue}`);

    const verify = await documentService.verifyDocument({ hashOrId: state.docId, adapter });
    expect(verify.verified).toBe(true);
    expect(verify.certificateStatus).toBe('Issued');
  }, T);

  it('revokes via multi-sig: create proposal → 2 signs → auto-execute → Revoked (mirrored)', async () => {
    const created = await proposalService.createProposal({
      type: 'revocation', title: 'Revoke GoldenPath cert', description: 'test revoke',
      targetRef: state.docId, creatorUserId: state.super._id, adapter,
    });
    expect(created.proposal.approvals).toBe(0);
    state.proposalId = created.proposal.id;
    // The on-chain proposal id is captured on the persisted proposal.
    const dbProp = await Proposal.findById(state.proposalId);
    expect(typeof dbProp.onChainId).toBe('number');

    const one = await proposalService.signProposal({ id: state.proposalId, signerUserId: state.rev1.user._id, adapter });
    expect(one.status).toBe('pending');
    expect(one.approvals).toBe(1);

    const two = await proposalService.signProposal({ id: state.proposalId, signerUserId: state.rev2.user._id, adapter });
    expect(two.status).toBe('executed');
    expect(two.approvals).toBe(2);

    const cert = await Certificate.findById(state.docId);
    expect(cert.status).toBe('revoked');
    expect(cert.chain.certificateStatus).toBe('Revoked');
    if (cert.chain.txHashRevoke) txlog.push(`revoke(execute): ${cert.chain.txHashRevoke}`);

    // Chain agrees.
    const verify = await documentService.verifyDocument({ hashOrId: state.docId, adapter });
    expect(verify.certificateStatus).toBe('Revoked');
    expect(verify.verified).toBe(false);
  }, T);
});
