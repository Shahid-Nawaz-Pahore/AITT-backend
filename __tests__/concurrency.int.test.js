// __tests__/concurrency.int.test.js
// Read-modify-write race fixes (H3/H4 concurrency). Two officers reviewing the
// same document concurrently must NOT lose a review (the atomic array upsert).
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Certificate = require('../src/models/Certificate');
const indexer = require('../src/services/indexer.service');

const HASH = 'f'.repeat(64);
const SUB1 = 'GSUB1' + '0'.repeat(51);
const SUB2 = 'GSUB2' + '0'.repeat(51);

let mongoServer;
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'ccy' });
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongoServer) await mongoServer.stop();
});
beforeEach(async () => {
  for (const k in mongoose.connection.collections) await mongoose.connection.collections[k].deleteMany({});
  await indexer.mirrorStoredDocument({ metadataHash: HASH, certificateName: 'r.pdf', subject: 'S' });
});

describe('concurrent mirrorReview by two different officers', () => {
  it('preserves BOTH reviews (no lost update)', async () => {
    await Promise.all([
      indexer.mirrorReview({ metadataHash: HASH, review: { reviewer: 'A', reviewerWallet: SUB1, decision: 'approved', complianceScore: 80 }, receipt: { hash: 'r1' } }),
      indexer.mirrorReview({ metadataHash: HASH, review: { reviewer: 'B', reviewerWallet: SUB2, decision: 'requires_changes', complianceScore: 40 }, receipt: { hash: 'r2' } }),
    ]);
    const cert = await Certificate.findOne({ metadataHash: HASH });
    expect(cert.reviews).toHaveLength(2);
    const wallets = cert.reviews.map((r) => r.reviewerWallet).sort();
    expect(wallets).toEqual([SUB1, SUB2].sort());
  });

  it('same officer re-reviewing does NOT duplicate the review', async () => {
    await indexer.mirrorReview({ metadataHash: HASH, review: { reviewer: 'A', reviewerWallet: SUB1, decision: 'requires_changes', complianceScore: 40, date: '2026-01-01' }, receipt: { hash: 'r1' } });
    await indexer.mirrorReview({ metadataHash: HASH, review: { reviewer: 'A', reviewerWallet: SUB1, decision: 'approved', complianceScore: 90, date: '2026-02-01' }, receipt: { hash: 'r2' } });
    const cert = await Certificate.findOne({ metadataHash: HASH });
    expect(cert.reviews).toHaveLength(1);
    expect(cert.reviews[0].decision).toBe('approved');
    expect(cert.status).toBe('approved');
    expect(cert.complianceScore).toBe(90);
  });
});
