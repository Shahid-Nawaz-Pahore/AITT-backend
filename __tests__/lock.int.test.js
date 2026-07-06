// __tests__/lock.int.test.js
// Lease-based distributed lock (D12) — the guard that stops scheduled jobs from
// double-running across a multi-instance deploy.
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { withLock, acquireLock, releaseLock } = require('../src/utils/lock');
const JobLock = require('../src/models/JobLock');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let mongoServer;
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'locktest' });
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongoServer) await mongoServer.stop();
});
beforeEach(async () => { await JobLock.deleteMany({}); });

describe('withLock — mutual exclusion', () => {
  it('runs only ONE of two concurrent holders of the same lock', async () => {
    let running = 0;
    let maxConcurrent = 0;
    const body = async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await sleep(60);
      running -= 1;
      return 'ran';
    };

    const [a, b] = await Promise.all([
      withLock('job-x', 10000, body),
      withLock('job-x', 10000, body),
    ]);

    const ran = [a, b].filter((r) => r.ran);
    expect(ran).toHaveLength(1);
    expect(maxConcurrent).toBe(1);
  });

  it('allows re-acquisition after the previous holder releases', async () => {
    const first = await withLock('job-y', 10000, async () => 'first');
    expect(first.ran).toBe(true);
    const second = await withLock('job-y', 10000, async () => 'second');
    expect(second.ran).toBe(true);
    expect(second.result).toBe('second');
  });

  it('reclaims an expired lease', async () => {
    const now = new Date();
    // Acquire with a short lease, do NOT release, then acquire again "after" it expires.
    expect(await acquireLock('job-z', 1000, now)).toBe(true);
    // A fresh acquire at now still blocked (lease live).
    expect(await acquireLock('job-z', 1000, now)).toBe(false);
    // 2s later the lease has expired -> reclaimable.
    const later = new Date(now.getTime() + 2000);
    expect(await acquireLock('job-z', 1000, later)).toBe(true);
    await releaseLock('job-z');
  });
});
