// src/config/env.js
// ---------------------------------------------------------------------------
// Fail-fast startup configuration validation (remediation H2 #4 + audit C2).
//
// The app must NEVER "limp along" with missing/invalid config. `validateEnv()`
// checks every required variable, applies safe defaults for optional ones, and
// aggregates ALL problems into a single clear error so an operator sees the full
// list at once instead of discovering them one crash at a time.
//
// Production guards (audit C2 — no silent fake chain / missing secrets in prod):
//   - NODE_ENV=production REFUSES to boot unless SOROBAN_ADAPTER=real
//     (a stub adapter in prod would silently fake the blockchain).
//   - JWT_ACCESS_SECRET and KEY_ENCRYPTION_SECRET must be set (and long enough).
//   - When the adapter is `real`, the chain creds (RPC_URL / CONTRACT_ID /
//     SERVICE_SECRET) must be present.
//
// Zero new dependencies: this is a small, fully-auditable validator rather than
// a heavyweight schema lib — deliberate, to keep the production supply chain
// minimal (see docs/API.md "Configuration"). It is import-safe: nothing runs
// until validateEnv() is called (server.js calls it at boot; tests do not, so
// requiring app.js in supertest never crashes).
// ---------------------------------------------------------------------------

const DURATION_RE = /^\d+\s*(ms|s|m|h|d|w|y)?$/i; // e.g. 15m, 7d, 900000

function isProd() {
  return String(process.env.NODE_ENV).toLowerCase() === 'production';
}

function selectedAdapter() {
  const explicit = String(process.env.SOROBAN_ADAPTER || '').toLowerCase();
  if (explicit === 'real' || explicit === 'stub') return explicit;
  if (String(process.env.USE_SOROBAN_STUB).toLowerCase() === 'false') return 'real';
  return 'stub';
}

// A single field spec. `required` (always) / `prodRequired` (only in production).
// `type` validates the RAW string; `def` is applied back onto process.env when
// the var is unset (so downstream `process.env.X` reads see the default).
function spec(name, opts = {}) {
  return { name, ...opts };
}

function buildSpecs() {
  const adapter = selectedAdapter();
  const realMode = adapter === 'real';

  return [
    spec('NODE_ENV', { def: 'development' }),
    spec('PORT', { type: 'port', def: '4000' }),

    // --- Datastore ---
    spec('MONGO_URI', { required: true, secret: true }),

    // --- Auth / crypto secrets ---
    spec('JWT_ACCESS_SECRET', { required: true, secret: true, minLen: isProd() ? 32 : 8 }),
    spec('JWT_ACCESS_TTL', { type: 'duration', def: '15m' }),
    spec('JWT_REFRESH_TTL', { type: 'duration', def: '60d' }),
    spec('BCRYPT_SALT_ROUNDS', { type: 'int', def: '12', min: 4, max: 15 }),
    // Custodial key encryption — REQUIRED in production (audit C2 / wallet.js).
    spec('KEY_ENCRYPTION_SECRET', { prodRequired: true, secret: true, minLen: 16 }),

    // --- Chain adapter ---
    spec('SOROBAN_ADAPTER', { def: 'stub', oneOf: ['stub', 'real'], normalize: true }),
    // Chain creds: required whenever the REAL adapter is selected.
    spec('RPC_URL', { required: realMode, type: 'url' }),
    spec('CONTRACT_ID', { required: realMode }),
    spec('SERVICE_SECRET', { required: realMode, secret: true }),
    spec('NETWORK_PASSPHRASE', { def: 'Test SDF Network ; September 2015' }),
    spec('OWNER_ADDRESS', {}),
    spec('FRIENDBOT_URL', { type: 'url', def: 'https://friendbot.stellar.org' }),

    // --- Tx tuning (bounded confirmation) ---
    spec('SOROBAN_TX_TIMEOUT_MS', { type: 'int', def: '60000', min: 1000 }),
    spec('SOROBAN_TX_POLL_INTERVAL_MS', { type: 'int', def: '1000', min: 100 }),
    spec('SOROBAN_TX_POLL_MAX_MS', { type: 'int', def: '5000', min: 100 }),
    spec('SOROBAN_TX_MAX_RETRIES', { type: 'int', def: '3', min: 0, max: 10 }),

    // --- Uploads / storage ---
    spec('STORAGE_DRIVER', { def: 'auto', oneOf: ['auto', 'disk', 'gridfs', 'memory'], normalize: true }),
    spec('USE_DISK_UPLOAD', { type: 'bool', def: 'false' }),
    spec('MAX_UPLOAD_BYTES', { type: 'int', def: '10485760', min: 1024 }),

    // --- Wallet funding (testnet friendbot) ---
    spec('AUTO_FUND_WALLETS', { type: 'bool', def: String(!isProd()) }),

    // --- Scheduler ---
    spec('ENABLE_SCHEDULER', { type: 'bool', def: String(isProd()) }),
    spec('EXPIRY_JOB_INTERVAL_MS', { type: 'int', def: '3600000', min: 60000 }),
    spec('RECONCILE_JOB_INTERVAL_MS', { type: 'int', def: '21600000', min: 60000 }),
    spec('OUTBOX_JOB_INTERVAL_MS', { type: 'int', def: '30000', min: 5000 }),
  ];
}

function validateOne(s, errors) {
  const raw = process.env[s.name];
  const present = raw !== undefined && raw !== null && String(raw).trim() !== '';

  if (!present) {
    if (s.required) { errors.push(`${s.name} is required but not set`); return; }
    if (s.prodRequired && isProd()) { errors.push(`${s.name} is required in production but not set`); return; }
    if (s.def !== undefined && raw === undefined) process.env[s.name] = s.def; // apply default
    return;
  }

  const val = String(raw);
  if (s.normalize) process.env[s.name] = val.toLowerCase();

  if (s.oneOf && !s.oneOf.includes(val.toLowerCase())) {
    errors.push(`${s.name} must be one of [${s.oneOf.join(', ')}] (got "${val}")`);
  }
  if (s.minLen && val.length < s.minLen) {
    errors.push(`${s.name} must be at least ${s.minLen} characters${s.secret ? '' : ` (got "${val}")`}`);
  }
  if (s.type === 'int') {
    const n = Number(val);
    if (!Number.isInteger(n)) errors.push(`${s.name} must be an integer (got "${val}")`);
    else {
      if (s.min !== undefined && n < s.min) errors.push(`${s.name} must be >= ${s.min} (got ${n})`);
      if (s.max !== undefined && n > s.max) errors.push(`${s.name} must be <= ${s.max} (got ${n})`);
    }
  }
  if (s.type === 'port') {
    const n = Number(val);
    if (!Number.isInteger(n) || n < 1 || n > 65535) errors.push(`${s.name} must be a valid port 1-65535 (got "${val}")`);
  }
  if (s.type === 'bool' && !/^(true|false)$/i.test(val)) {
    errors.push(`${s.name} must be "true" or "false" (got "${val}")`);
  }
  if (s.type === 'duration' && !DURATION_RE.test(val)) {
    errors.push(`${s.name} must be a duration like 15m / 7d / 900000 (got "${val}")`);
  }
  if (s.type === 'url' && !/^https?:\/\//i.test(val)) {
    errors.push(`${s.name} must be an http(s) URL (got "${val}")`);
  }
}

/**
 * validateEnv({ exitOnError }) — validate + apply defaults. Returns the resolved
 * config summary (secrets redacted). Throws an aggregated Error on any problem
 * (or process.exit(1) when exitOnError is set — used at server boot).
 */
function validateEnv({ exitOnError = false, logger = console } = {}) {
  const errors = [];
  const specs = buildSpecs();
  for (const s of specs) validateOne(s, errors);

  // --- Production hard guards (audit C2) ---
  if (isProd()) {
    if (selectedAdapter() !== 'real') {
      errors.push('SOROBAN_ADAPTER must be "real" in production — refusing to boot against the in-memory stub (would silently fake the blockchain). Set SOROBAN_ADAPTER=real.');
    }
  }

  if (errors.length) {
    const msg = `Invalid configuration — refusing to start:\n  - ${errors.join('\n  - ')}`;
    if (exitOnError) {
      // Use the raw logger to guarantee the message is seen even if winston isn't up.
      (logger.error ? logger.error.bind(logger) : console.error)(msg);
      process.exit(1);
    }
    const err = new Error(msg);
    err.envErrors = errors;
    throw err;
  }

  return summary();
}

// Non-secret summary of the resolved config (safe to log).
function summary() {
  return {
    nodeEnv: process.env.NODE_ENV,
    port: Number(process.env.PORT),
    adapter: selectedAdapter(),
    contractId: process.env.CONTRACT_ID || null,
    network: process.env.NETWORK_PASSPHRASE || null,
    storageDriver: process.env.STORAGE_DRIVER,
    autoFundWallets: String(process.env.AUTO_FUND_WALLETS).toLowerCase() === 'true',
    schedulerEnabled: String(process.env.ENABLE_SCHEDULER).toLowerCase() === 'true',
    hasKeyEncryptionSecret: !!process.env.KEY_ENCRYPTION_SECRET,
    hasJwtSecret: !!process.env.JWT_ACCESS_SECRET,
  };
}

module.exports = { validateEnv, summary, selectedAdapter, isProd };
