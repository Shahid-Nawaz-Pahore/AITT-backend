// __tests__/funding.unit.test.js
// Custodial wallet funding (B5). No DB/chain; global fetch is stubbed.
const funding = require('../src/services/funding.service');

const ENV = { ...process.env };
let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; process.env = { ...ENV }; });

const PUB = 'GTESTWALLET0000000000000000000000000000000000000000000';

describe('fundIfEnabled — onboarding gate', () => {
  it('skips when AUTO_FUND_WALLETS is off', async () => {
    process.env.AUTO_FUND_WALLETS = 'false';
    process.env.SOROBAN_ADAPTER = 'real';
    const res = await funding.fundIfEnabled(PUB);
    expect(res).toEqual({ funded: false, skipped: 'auto-fund-disabled' });
  });

  it('skips in stub mode even when AUTO_FUND is on', async () => {
    process.env.AUTO_FUND_WALLETS = 'true';
    process.env.SOROBAN_ADAPTER = 'stub';
    const res = await funding.fundIfEnabled(PUB);
    expect(res).toEqual({ funded: false, skipped: 'stub-mode' });
  });

  it('funds in real mode when enabled (via friendbot)', async () => {
    process.env.AUTO_FUND_WALLETS = 'true';
    process.env.SOROBAN_ADAPTER = 'real';
    process.env.NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ hash: 'fund-tx' }) });
    const res = await funding.fundIfEnabled(PUB);
    expect(res.funded).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('is non-fatal when friendbot fails', async () => {
    process.env.AUTO_FUND_WALLETS = 'true';
    process.env.SOROBAN_ADAPTER = 'real';
    process.env.NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ detail: 'boom' }) });
    const res = await funding.fundIfEnabled(PUB);
    expect(res.funded).toBe(false);
    expect(res.error).toBeTruthy();
  });
});

describe('fundWallet', () => {
  it('treats "account already funded" as success', async () => {
    process.env.NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ detail: 'op_already_exists' }) });
    const res = await funding.fundWallet(PUB);
    expect(res).toEqual({ funded: true, alreadyFunded: true });
  });

  it('refuses to fund on mainnet (surfaces the seam)', async () => {
    process.env.NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
    await expect(funding.fundWallet(PUB)).rejects.toMatchObject({ statusCode: 501 });
  });
});
