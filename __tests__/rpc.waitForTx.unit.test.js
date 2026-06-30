// __tests__/rpc.waitForTx.unit.test.js
// The NOT_FOUND fix: waitForTransaction must be BOUNDED. We drive it with a
// fake server + injected clock/sleep so a permanently-NOT_FOUND tx can never
// hang the test (it throws 504), while normal confirmation resolves.
const rpc = require('../src/services/sorobanAdapter/rpc');

// A controllable clock: each sleep(ms) advances virtual time by ms.
function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms) => { t += ms; },
  };
}

describe('waitForTransaction — bounded polling', () => {
  it('throws AppError(504) instead of looping forever when always NOT_FOUND', async () => {
    const clock = makeClock();
    let calls = 0;
    const server = { getTransaction: async () => { calls += 1; return { status: 'NOT_FOUND' }; } };

    await expect(
      rpc.waitForTransaction(server, 'hash', {
        timeoutMs: 1000, pollIntervalMs: 100, pollMaxIntervalMs: 300,
        now: clock.now, sleep: clock.sleep,
      }),
    ).rejects.toMatchObject({ statusCode: 504 });

    // Bounded: a handful of polls, NOT an unbounded spin.
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThan(50);
  });

  it('resolves once the tx is found after a few NOT_FOUND polls', async () => {
    const clock = makeClock();
    let calls = 0;
    const server = {
      getTransaction: async () => {
        calls += 1;
        return calls < 3 ? { status: 'NOT_FOUND' } : { status: 'SUCCESS', ledger: 42 };
      },
    };

    const res = await rpc.waitForTransaction(server, 'hash', {
      timeoutMs: 10000, pollIntervalMs: 100, now: clock.now, sleep: clock.sleep,
    });
    expect(res.status).toBe('SUCCESS');
    expect(res.ledger).toBe(42);
    expect(calls).toBe(3);
  });

  it('throws AppError(502) when the tx confirms as FAILED', async () => {
    const clock = makeClock();
    const server = { getTransaction: async () => ({ status: 'FAILED', resultXdr: 'xxx' }) };
    await expect(
      rpc.waitForTransaction(server, 'hash', { timeoutMs: 1000, now: clock.now, sleep: clock.sleep }),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it('back-off interval grows but is capped at pollMaxIntervalMs', async () => {
    const intervals = [];
    let t = 0;
    const now = () => t;
    const sleep = async (ms) => { intervals.push(ms); t += ms; };
    let calls = 0;
    const server = { getTransaction: async () => { calls += 1; return calls < 6 ? { status: 'NOT_FOUND' } : { status: 'SUCCESS' }; } };

    await rpc.waitForTransaction(server, 'h', { timeoutMs: 100000, pollIntervalMs: 100, pollMaxIntervalMs: 250, now, sleep });
    // 100 -> 150 -> 225 -> 250(capped) -> 250(capped)
    expect(intervals[0]).toBe(100);
    expect(Math.max(...intervals)).toBeLessThanOrEqual(250);
    expect(intervals[intervals.length - 1]).toBe(250);
  });
});

describe('rpc module is import-safe', () => {
  it('loads without RPC_URL/CONTRACT_ID/SERVICE_SECRET and only throws when getConfig() is called', () => {
    const saved = { r: process.env.RPC_URL, c: process.env.CONTRACT_ID, s: process.env.SERVICE_SECRET };
    delete process.env.RPC_URL; delete process.env.CONTRACT_ID; delete process.env.SERVICE_SECRET;
    rpc._resetForTest();
    try {
      expect(() => rpc.getConfig()).toThrow(/missing/i);
    } finally {
      Object.assign(process.env, { RPC_URL: saved.r, CONTRACT_ID: saved.c, SERVICE_SECRET: saved.s });
      rpc._resetForTest();
    }
  });
});
