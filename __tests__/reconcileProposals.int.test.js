// __tests__/reconcileProposals.int.test.js
// Proposal reconciliation (E-audit M4): an approve that committed on-chain but
// whose sign-time readback failed leaves the DB proposal stuck 'pending'.
// reconcileProposals reads the chain (source of truth) and heals it.
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Proposal = require('../src/models/Proposal');
const Certificate = require('../src/models/Certificate');
const indexer = require('../src/services/indexer.service');
const reconcile = require('../src/services/reconcile.service');

const HASH = 'a1'.repeat(32);

let mongoServer;
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'recprop' });
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongoServer) await mongoServer.stop();
});
beforeEach(async () => {
  for (const k in mongoose.connection.collections) await mongoose.connection.collections[k].deleteMany({});
});

describe('reconcileProposals', () => {
  it('heals a pending on-chain proposal that actually executed on-chain (and mirrors the revoke)', async () => {
    // The cert exists and is Issued in the DB.
    await indexer.mirrorStoredDocument({ metadataHash: HASH, certificateName: 'r.pdf', subject: 'S' });
    await indexer.mirrorIssuedCertificate({ metadataHash: HASH, expiryUnix: 4000000000, receipt: { hash: 'i' } });

    // DB proposal is stuck 'pending' (readback failed at sign time).
    const p = await Proposal.create({
      type: 'revocation', title: 'r', status: 'pending', onChain: true, onChainId: 7,
      signers: [], executed: false, threshold: 2, payload: { docHash: HASH },
    });

    // The chain says it's executed with 2 approvals.
    const adapter = { readProposal: async () => ({ id: 7, approvals: ['GA', 'GB'], executed: true }) };

    const res = await reconcile.reconcileProposals({ adapter, fix: true });
    expect(res.fixed).toBe(1);

    const healed = await Proposal.findById(p._id);
    expect(healed.status).toBe('executed');
    expect(healed.signers).toHaveLength(2);

    // The revoke side-effect was mirrored onto the certificate.
    const cert = await Certificate.findOne({ metadataHash: HASH });
    expect(cert.status).toBe('revoked');
    expect(cert.chain.certificateStatus).toBe('Revoked');
  });

  it('reports (does not fix) drift when fix=false', async () => {
    await Proposal.create({
      type: 'governance_rule', title: 'g', status: 'pending', onChain: true, onChainId: 8,
      signers: [], executed: false, threshold: 1, payload: { value: 2 },
    });
    const adapter = { readProposal: async () => ({ id: 8, approvals: ['GA'], executed: true }) };
    const res = await reconcile.reconcileProposals({ adapter, fix: false });
    expect(res.drifted).toBe(1);
    expect(res.fixed).toBe(0);
  });

  it('tolerates an RPC hiccup on readback (skips, does not throw)', async () => {
    await Proposal.create({
      type: 'revocation', title: 'r', status: 'pending', onChain: true, onChainId: 9,
      signers: [], executed: false, threshold: 2, payload: { docHash: HASH },
    });
    const adapter = { readProposal: async () => { throw new Error('rpc down'); } };
    const res = await reconcile.reconcileProposals({ adapter, fix: true });
    expect(res.fixed).toBe(0);
  });
});
