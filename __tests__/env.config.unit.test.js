// __tests__/env.config.unit.test.js
// Fail-fast config validation (H2 #4 + audit C2). No DB / chain needed.
const { validateEnv } = require('../src/config/env');

// Snapshot/restore the whole environment around each case.
const ORIGINAL = { ...process.env };
function resetEnv(overrides = {}) {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, overrides);
}
afterAll(() => { resetEnv(ORIGINAL); });

// A minimally-valid dev environment.
function devBase() {
  return {
    NODE_ENV: 'development',
    MONGO_URI: 'mongodb://localhost:27017/db',
    JWT_ACCESS_SECRET: 'dev-secret',
    SOROBAN_ADAPTER: 'stub',
  };
}

describe('validateEnv — required fields', () => {
  it('throws when MONGO_URI is missing', () => {
    resetEnv({ NODE_ENV: 'development', JWT_ACCESS_SECRET: 'x' });
    expect(() => validateEnv()).toThrow(/MONGO_URI is required/);
  });

  it('throws when JWT_ACCESS_SECRET is missing', () => {
    resetEnv({ NODE_ENV: 'development', MONGO_URI: 'mongodb://localhost/db' });
    expect(() => validateEnv()).toThrow(/JWT_ACCESS_SECRET is required/);
  });

  it('passes for a minimal valid dev config and applies defaults', () => {
    resetEnv(devBase());
    const summary = validateEnv();
    expect(summary.adapter).toBe('stub');
    // defaults applied back onto process.env
    expect(process.env.PORT).toBe('4000');
    expect(process.env.NETWORK_PASSPHRASE).toContain('Test SDF Network');
    expect(process.env.SOROBAN_TX_TIMEOUT_MS).toBe('60000');
  });

  it('rejects a non-integer numeric var', () => {
    resetEnv({ ...devBase(), BCRYPT_SALT_ROUNDS: 'abc' });
    expect(() => validateEnv()).toThrow(/BCRYPT_SALT_ROUNDS must be an integer/);
  });

  it('rejects an out-of-range port', () => {
    resetEnv({ ...devBase(), PORT: '70000' });
    expect(() => validateEnv()).toThrow(/PORT must be a valid port/);
  });
});

describe('validateEnv — production guards (audit C2)', () => {
  it('refuses to boot in production with the stub adapter', () => {
    resetEnv({
      NODE_ENV: 'production',
      MONGO_URI: 'mongodb://db/x',
      JWT_ACCESS_SECRET: 'a-very-long-production-secret-value-1234',
      KEY_ENCRYPTION_SECRET: 'production-key-encryption-secret',
      SOROBAN_ADAPTER: 'stub',
      RPC_URL: 'https://rpc', CONTRACT_ID: 'C', SERVICE_SECRET: 'S',
    });
    expect(() => validateEnv()).toThrow(/SOROBAN_ADAPTER must be "real" in production/);
  });

  it('refuses to boot in production without KEY_ENCRYPTION_SECRET', () => {
    resetEnv({
      NODE_ENV: 'production',
      MONGO_URI: 'mongodb://db/x',
      JWT_ACCESS_SECRET: 'a-very-long-production-secret-value-1234',
      SOROBAN_ADAPTER: 'real',
      RPC_URL: 'https://rpc', CONTRACT_ID: 'C', SERVICE_SECRET: 'S',
    });
    expect(() => validateEnv()).toThrow(/KEY_ENCRYPTION_SECRET is required in production/);
  });

  it('refuses to boot in production with a too-short JWT secret', () => {
    resetEnv({
      NODE_ENV: 'production',
      MONGO_URI: 'mongodb://db/x',
      JWT_ACCESS_SECRET: 'short',
      KEY_ENCRYPTION_SECRET: 'production-key-encryption-secret',
      SOROBAN_ADAPTER: 'real',
      RPC_URL: 'https://rpc', CONTRACT_ID: 'C', SERVICE_SECRET: 'S',
    });
    expect(() => validateEnv()).toThrow(/JWT_ACCESS_SECRET must be at least 32 characters/);
  });

  it('requires chain creds when the real adapter is selected', () => {
    resetEnv({
      NODE_ENV: 'production',
      MONGO_URI: 'mongodb://db/x',
      JWT_ACCESS_SECRET: 'a-very-long-production-secret-value-1234',
      KEY_ENCRYPTION_SECRET: 'production-key-encryption-secret',
      SOROBAN_ADAPTER: 'real',
      // RPC_URL / CONTRACT_ID / SERVICE_SECRET intentionally missing
    });
    const err = (() => { try { validateEnv(); return null; } catch (e) { return e; } })();
    expect(err).toBeTruthy();
    expect(err.envErrors.join('\n')).toMatch(/RPC_URL is required/);
    expect(err.envErrors.join('\n')).toMatch(/CONTRACT_ID is required/);
    expect(err.envErrors.join('\n')).toMatch(/SERVICE_SECRET is required/);
  });

  it('accepts a fully-configured production real-adapter config', () => {
    resetEnv({
      NODE_ENV: 'production',
      MONGO_URI: 'mongodb://db/x',
      JWT_ACCESS_SECRET: 'a-very-long-production-secret-value-1234',
      KEY_ENCRYPTION_SECRET: 'production-key-encryption-secret',
      SOROBAN_ADAPTER: 'real',
      RPC_URL: 'https://soroban-testnet.stellar.org',
      CONTRACT_ID: 'CA6KYPPXEUTAP4X6JAEOI37OD2SCKEAUOSV2VN5ICDWCAI4WASFHRSYB',
      SERVICE_SECRET: 'SXXXX',
    });
    const summary = validateEnv();
    expect(summary.adapter).toBe('real');
    expect(summary.hasKeyEncryptionSecret).toBe(true);
  });
});
