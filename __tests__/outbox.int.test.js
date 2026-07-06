// __tests__/outbox.int.test.js
// Durable chain→DB mirror outbox (H3 #6): writeThrough persists a pending row
// before mirroring; a crash/inline-failure leaves it pending; the processor
// replays the idempotent mirror to convergence; exhausted retries dead-letter.
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Certificate = require('../src/models/Certificate');
const Outbox = require('../src/models/Outbox');
const indexer = require('../src/services/indexer.service');
const { processOutbox, pendingCount, deadLetterCount } = require('../src/services/outbox.service');

const HASH = 'a'.repeat(64);
const HASH2 = 'c'.repeat(64);

// Minimal fake adapter — writeThrough only needs adapter[method] to return a receipt.
const fakeAdapter = {
  issueCertificate: async () => ({ hash: 'issue-h', source: 'stub', status: 'simulated' }),
};

let mongoServer;
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'outboxtest' });
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongoServer) await mongoServer.stop();
});
beforeEach(async () => {
  for (const k in mongoose.connection.collections) await mongoose.connection.collections[k].deleteMany({});
});

describe('writeThrough durability', () => {
  it('persists an Outbox row and marks it done when the mirror succeeds', async () => {
    await indexer.mirrorStoredDocument({ metadataHash: HASH, certificateName: 'r.pdf', subject: 'S' });

    const { outbox } = await indexer.writeThrough({
      adapter: fakeAdapter,
      method: 'issueCertificate',
      args: ['GADMIN', HASH, 4000000000, {}],
      purpose: 'issue',
      mirror: { op: 'mirrorIssuedCertificate', payload: { metadataHash: HASH, expiryUnix: 4000000000 } },
    });

    const row = await Outbox.findById(outbox._id);
    expect(row.status).toBe('done');
    expect(row.mirroredAt).toBeTruthy();

    const cert = await Certificate.findOne({ metadataHash: HASH });
    expect(cert.status).toBe('issued');
    expect(await pendingCount()).toBe(0);
  });

  it('leaves the row PENDING (and rethrows) when the inline mirror fails, then the processor heals it', async () => {
    // No cert yet -> mirrorIssuedCertificate throws inline.
    await expect(indexer.writeThrough({
      adapter: fakeAdapter,
      method: 'issueCertificate',
      args: ['GADMIN', HASH2, 4000000000, {}],
      purpose: 'issue',
      mirror: { op: 'mirrorIssuedCertificate', payload: { metadataHash: HASH2, expiryUnix: 4000000000 } },
    })).rejects.toBeTruthy();

    // The chain write is NOT lost — it is captured as a pending outbox row.
    expect(await pendingCount()).toBe(1);
    const pending = await Outbox.findOne({ status: 'pending' });
    expect(pending.op).toBe('mirrorIssuedCertificate');
    expect(pending.lastError).toBeTruthy();
    expect(pending.attempts).toBe(0);

    // Now the prerequisite state exists (e.g. the store mirror caught up).
    await indexer.mirrorStoredDocument({ metadataHash: HASH2, certificateName: 'r2.pdf', subject: 'S' });

    const res = await processOutbox({});
    expect(res.done).toBe(1);
    expect(await pendingCount()).toBe(0);

    const cert = await Certificate.findOne({ metadataHash: HASH2 });
    expect(cert.status).toBe('issued');
  });

  it('dead-letters a row after exhausting maxAttempts', async () => {
    await Outbox.create({
      op: 'mirrorIssuedCertificate',
      payload: { metadataHash: 'd'.repeat(64), expiryUnix: 4000000000 },
      receipt: { hash: 'x' },
      maxAttempts: 1,
      nextAttemptAt: new Date(Date.now() - 1000),
    });

    const res = await processOutbox({});
    expect(res.failed).toBe(1);
    expect(await deadLetterCount()).toBe(1);
    expect(await pendingCount()).toBe(0);
  });

  it('respects nextAttemptAt backoff (not-yet-due rows are skipped)', async () => {
    await Outbox.create({
      op: 'mirrorIssuedCertificate',
      payload: { metadataHash: 'e'.repeat(64) },
      receipt: { hash: 'y' },
      nextAttemptAt: new Date(Date.now() + 60 * 1000), // due in the future
    });
    const res = await processOutbox({});
    expect(res.processed).toBe(0);
    expect(await pendingCount()).toBe(1);
  });
});
