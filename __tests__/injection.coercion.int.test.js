// __tests__/injection.coercion.int.test.js
// H1 #8 defense-in-depth: list filters must IGNORE injected operator objects
// (not apply them as Mongo query operators). In-memory Mongo.
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Certificate = require('../src/models/Certificate');
const Proposal = require('../src/models/Proposal');
const documentService = require('../src/services/document.service');
const proposalService = require('../src/services/proposal.service');

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

describe('document list filter coercion', () => {
  beforeEach(async () => {
    await Certificate.create([
      { certificateName: 'a', subject: 's', metadataHash: 'a'.repeat(64), status: 'issued' },
      { certificateName: 'b', subject: 's', metadataHash: 'b'.repeat(64), status: 'submitted' },
    ]);
  });

  it('an injected {$ne} status is ignored -> returns ALL docs (no operator injection)', async () => {
    const res = await documentService.listDocuments({ user: { role: 'super_admin' }, status: { $ne: 'issued' } });
    expect(res.total).toBe(2);
  });

  it('a valid string status still filters', async () => {
    const res = await documentService.listDocuments({ user: { role: 'super_admin' }, status: 'issued' });
    expect(res.total).toBe(1);
  });

  it('an unknown string status is ignored (not applied)', async () => {
    const res = await documentService.listDocuments({ user: { role: 'super_admin' }, status: 'bogus' });
    expect(res.total).toBe(2);
  });
});

describe('proposal list filter coercion', () => {
  it('an injected {$ne} type is ignored -> returns ALL proposals', async () => {
    await Proposal.create({ type: 'revocation', title: 't', threshold: 1, createdBy: 'x' });
    const res = await proposalService.listProposals({ type: { $ne: 'revocation' } });
    expect(res.pagination.total).toBe(1);
  });
});
