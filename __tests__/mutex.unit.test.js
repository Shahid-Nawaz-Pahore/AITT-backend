// __tests__/mutex.unit.test.js
// Keyed async mutex (H4 #13) — serialize same-key ops, parallelize different keys.
const { runExclusive } = require('../src/utils/mutex');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('runExclusive', () => {
  it('serializes operations sharing a key (no overlap)', async () => {
    let active = 0;
    let maxActive = 0;
    const op = async () => {
      active += 1; maxActive = Math.max(maxActive, active);
      await sleep(30);
      active -= 1;
      return 'done';
    };
    const res = await Promise.all([
      runExclusive('k', op), runExclusive('k', op), runExclusive('k', op),
    ]);
    expect(res).toEqual(['done', 'done', 'done']);
    expect(maxActive).toBe(1); // never ran two at once
  });

  it('runs different keys concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    const op = async () => {
      active += 1; maxActive = Math.max(maxActive, active);
      await sleep(30);
      active -= 1;
    };
    await Promise.all([runExclusive('a', op), runExclusive('b', op)]);
    expect(maxActive).toBe(2); // both keys ran in parallel
  });

  it('a rejection does not wedge the queue for that key', async () => {
    const bad = runExclusive('k2', async () => { throw new Error('boom'); });
    await expect(bad).rejects.toThrow('boom');
    const good = await runExclusive('k2', async () => 'ok');
    expect(good).toBe('ok');
  });

  it('returns the real result/error to the caller', async () => {
    await expect(runExclusive('k3', async () => 42)).resolves.toBe(42);
  });
});
