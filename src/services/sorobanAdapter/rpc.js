// src/services/sorobanAdapter/rpc.js
// ---------------------------------------------------------------------------
// Low-level Stellar/Soroban RPC core for the REAL adapter. Two deliberate fixes
// over the legacy soroban.service.js:
//   1. IMPORT-SAFE: config + clients are lazily built (memoized) on first use,
//      so requiring this module never throws when env is unset (tests can load
//      it / auto-mock it without RPC_URL/CONTRACT_ID/SERVICE_SECRET).
//   2. BOUNDED confirmation: waitForTransaction() polls getTransaction with a
//      hard deadline + capped back-off instead of `while (NOT_FOUND)` forever.
//      On timeout it throws AppError(504); on FAILED it throws AppError(502).
//
// Everything that talks to a `server` object is injectable so the bounded-wait
// and tx flow can be unit-tested against a fake server (no live chain needed).
// ---------------------------------------------------------------------------
const {
  rpc: SorobanRpc,
  Keypair,
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  scValToNative,
  nativeToScVal,
  Address,
  xdr,
} = require('@stellar/stellar-sdk');

const logger = require('../../utils/logger');
const AppError = require('../../utils/AppError');
const { runExclusive } = require('../../utils/mutex');

// ---------------------------------------------------------------------------
// Lazy, memoized config + clients (import-safe)
// ---------------------------------------------------------------------------
let _config = null;
let _clients = null;

function getConfig() {
  if (_config) return _config;
  const RPC_URL = process.env.RPC_URL;
  const CONTRACT_ID = process.env.CONTRACT_ID;
  const SERVICE_SECRET = process.env.SERVICE_SECRET;

  const missing = [];
  if (!RPC_URL) missing.push('RPC_URL');
  if (!CONTRACT_ID) missing.push('CONTRACT_ID');
  if (!SERVICE_SECRET) missing.push('SERVICE_SECRET');
  if (missing.length) {
    throw new AppError(500, `Soroban adapter not configured: missing ${missing.join(', ')}`);
  }

  _config = {
    RPC_URL,
    CONTRACT_ID,
    SERVICE_SECRET,
    NETWORK_PASSPHRASE: process.env.NETWORK_PASSPHRASE || Networks.TESTNET,
    OWNER_ADDRESS: process.env.OWNER_ADDRESS || null,
    FRIENDBOT_URL: process.env.FRIENDBOT_URL || 'https://friendbot.stellar.org',
    // Bounded-confirmation tuning (overridable via env).
    txTimeoutMs: Number(process.env.SOROBAN_TX_TIMEOUT_MS || 60000),
    pollIntervalMs: Number(process.env.SOROBAN_TX_POLL_INTERVAL_MS || 1000),
    pollMaxIntervalMs: Number(process.env.SOROBAN_TX_POLL_MAX_MS || 5000),
    // tx_bad_seq retry: extra rebuild+resubmit attempts with a fresh sequence.
    txMaxRetries: Number(process.env.SOROBAN_TX_MAX_RETRIES || 3),
  };
  return _config;
}

function getClients() {
  if (_clients) return _clients;
  const cfg = getConfig();
  _clients = {
    server: new SorobanRpc.Server(cfg.RPC_URL),
    contract: new Contract(cfg.CONTRACT_ID),
    serviceKP: Keypair.fromSecret(cfg.SERVICE_SECRET),
  };
  return _clients;
}

// Test hook: drop memoized config/clients so a fresh env / fake clients apply.
function _resetForTest() {
  _config = null;
  _clients = null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// ScVal helpers
// ---------------------------------------------------------------------------
const addressScVal = (pubKey) => nativeToScVal(new Address(pubKey));
const stringScVal = (str) => nativeToScVal(str, { type: 'string' });
const u32ScVal = (n) => nativeToScVal(Number(n), { type: 'u32' });
const u64ScVal = (n) => nativeToScVal(BigInt(n), { type: 'u64' });
const symbolScVal = (s) => nativeToScVal(s, { type: 'symbol' });
function bytesN32ScVal(hexOrBuf) {
  const buf = Buffer.isBuffer(hexOrBuf) ? hexOrBuf : Buffer.from(String(hexOrBuf).replace(/^0x/, ''), 'hex');
  if (buf.length !== 32) {
    throw new AppError(400, `BytesN<32> expects 32 bytes, got ${buf.length} (input: ${String(hexOrBuf).slice(0, 12)}…)`);
  }
  return nativeToScVal(buf, { type: 'bytes' });
}
// A Soroban contracttype enum is encoded as a vec: [Symbol(variant), ...payload].
function enumScVal(variant, ...payloadScVals) {
  return xdr.ScVal.scvVec([symbolScVal(variant), ...payloadScVals]);
}

function safeValue(val) {
  if (typeof val === 'bigint') return val.toString();
  if (Buffer.isBuffer(val)) return val.toString('hex');
  if (Array.isArray(val)) return val.map(safeValue);
  if (val && typeof val === 'object') {
    return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, safeValue(v)]));
  }
  return val;
}

// ---------------------------------------------------------------------------
// Bounded confirmation — the NOT_FOUND fix
// ---------------------------------------------------------------------------
/**
 * waitForTransaction(server, hash, opts) — poll getTransaction until it is no
 * longer NOT_FOUND, bounded by opts.timeoutMs. Back-off grows from
 * pollIntervalMs up to pollMaxIntervalMs. Returns the final tx response.
 * Throws AppError(504) on timeout, AppError(502) on FAILED.
 *
 * `opts.now` and `opts.sleep` are injectable for deterministic tests.
 */
async function waitForTransaction(server, hash, opts = {}) {
  const {
    timeoutMs = 60000,
    pollIntervalMs = 1000,
    pollMaxIntervalMs = 5000,
    now = () => Date.now(),
    sleep: sleepFn = sleep,
  } = opts;

  const deadline = now() + timeoutMs;
  let interval = pollIntervalMs;
  let attempts = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const txResp = await server.getTransaction(hash);
    attempts += 1;

    if (txResp.status !== 'NOT_FOUND') {
      if (txResp.status === 'FAILED') {
        throw new AppError(502, 'Transaction failed on-chain', JSON.stringify(safeValue(txResp.resultXdr ?? txResp)).slice(0, 300));
      }
      return txResp; // SUCCESS (or any other terminal status)
    }

    if (now() >= deadline) {
      throw new AppError(504, `Transaction confirmation timed out after ${attempts} attempts (${timeoutMs}ms)`, hash);
    }

    await sleepFn(interval);
    interval = Math.min(Math.floor(interval * 1.5), pollMaxIntervalMs);
  }
}

// ---------------------------------------------------------------------------
// Write / read tx flows
// ---------------------------------------------------------------------------
// Pull the result code name (e.g. 'txBadSeq') out of a sendTransaction
// errorResult (an xdr.TransactionResult). Best-effort; null if it can't read it.
function txErrorName(errorResult) {
  try {
    const name = errorResult && errorResult.result && errorResult.result().switch().name;
    return name || null;
  } catch (_) {
    return null;
  }
}

// Result codes that are safe to retry by rebuilding with a fresh sequence.
const RETRYABLE_TX_ERRORS = new Set(['txBadSeq']);

const isBadSeqError = (err) =>
  /badseq|bad_seq|txbadseq/i.test(String((err && (err.details || err.message)) || ''));

/**
 * sendTx(method, args, signerKP?) — build, prepare, simulate, sign, send, and
 * wait (bounded) for confirmation. Defaults to custodial signing (serviceKP).
 *
 * Per-attempt the source account (sequence) is re-fetched, so a `tx_bad_seq`
 * (stale sequence under back-to-back custodial submits) is retried up to
 * cfg.txMaxRetries times before surfacing.
 */
async function sendTx(method, args = [], signerKP = null) {
  const cfg = getConfig();
  const { serviceKP } = getClients();
  const kp = signerKP || serviceKP;
  // Serialize all sends signed by the SAME key so their sequence numbers can't
  // collide under concurrent writes (H4 #13). Different signers run in parallel.
  return runExclusive(`tx:${kp.publicKey()}`, () => _sendTxInner(method, args, kp));
}

async function _sendTxInner(method, args, kp) {
  const cfg = getConfig();
  const { server, contract } = getClients();
  const startedAt = Date.now();
  const maxAttempts = Math.max(1, Number(cfg.txMaxRetries || 0) + 1);

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      logger.info('sendTx start', { method, argCount: args.length, signer: kp.publicKey().slice(0, 8), attempt });
      // Fresh sequence each attempt (the bad-seq fix).
      const src = await server.getAccount(kp.publicKey());

      let tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: cfg.NETWORK_PASSPHRASE })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

      // prepareTransaction simulates + assembles the Soroban footprint and the
      // resource fee (BASE_FEE is only the inclusion fee).
      tx = await server.prepareTransaction(tx);

      const sim = await server.simulateTransaction(tx);
      const simErr = sim?.error ?? sim?.result?.err;
      if (!sim || simErr) {
        throw new AppError(502, `Simulation failed for ${method}`, JSON.stringify(simErr ?? sim ?? {}).slice(0, 300));
      }

      tx.sign(kp);

      const sendResp = await server.sendTransaction(tx);
      if (sendResp.errorResult) {
        const name = txErrorName(sendResp.errorResult);
        if (RETRYABLE_TX_ERRORS.has(name) && attempt < maxAttempts) {
          logger.warn('sendTx retryable submit error — refetching sequence', { method, code: name, attempt });
          await sleep(cfg.pollIntervalMs);
          continue;
        }
        throw new AppError(502, `Transaction submission failed for ${method}`, `${name || 'submit error'}: ${JSON.stringify(safeValue(sendResp.errorResult)).slice(0, 250)}`);
      }

      const txResp = await waitForTransaction(server, sendResp.hash, {
        timeoutMs: cfg.txTimeoutMs,
        pollIntervalMs: cfg.pollIntervalMs,
        pollMaxIntervalMs: cfg.pollMaxIntervalMs,
      });

      const receipt = {
        hash: sendResp.hash,
        status: txResp.status,
        ledger: txResp.ledger,
        feeCharged: txResp.feeCharged,
        latencyMs: Date.now() - startedAt,
        returnValue: txResp.returnValue ? safeValue(scValToNative(txResp.returnValue)) : null,
        source: 'real',
      };
      logger.info('sendTx success', { method, hash: receipt.hash, status: receipt.status, latencyMs: receipt.latencyMs });
      return receipt;
    } catch (err) {
      lastErr = err;
      // A bad-seq can also surface as a FAILED tx from waitForTransaction.
      if (isBadSeqError(err) && attempt < maxAttempts) {
        logger.warn('sendTx retry after bad-seq failure', { method, attempt });
        await sleep(cfg.pollIntervalMs);
        continue;
      }
      logger.error('sendTx failed', { method, message: err?.message?.slice?.(0, 200) ?? String(err) });
      throw err instanceof AppError ? err : new AppError(502, `sendTx failed for ${method}: ${(err?.message ?? String(err)).slice(0, 180)}`, err.message ?? String(err));
    }
  }
  throw lastErr instanceof AppError ? lastErr : new AppError(502, `sendTx failed for ${method}: ${String(lastErr?.message ?? lastErr).slice(0, 180)}`, String(lastErr));
}

/**
 * fetchValue(method, args) — read-only simulate, returns the native return value.
 */
async function fetchValue(method, args = []) {
  const cfg = getConfig();
  const { server, contract, serviceKP } = getClients();
  try {
    const src = await server.getAccount(serviceKP.publicKey());
    const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: cfg.NETWORK_PASSPHRASE })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const prep = await server.prepareTransaction(tx);
    const sim = await server.simulateTransaction(prep);
    const simErr = sim?.error ?? sim?.result?.err;
    if (!sim || simErr) {
      throw new AppError(502, `Simulation failed for ${method}`, JSON.stringify(simErr ?? sim ?? {}).slice(0, 300));
    }

    const val = safeValue(scValToNative(sim.result?.retval));
    return val ?? null;
  } catch (err) {
    logger.error('fetchValue failed', { method, message: err?.message?.slice?.(0, 200) ?? String(err) });
    throw err instanceof AppError ? err : new AppError(502, `fetchValue failed for ${method}: ${(err?.message ?? String(err)).slice(0, 180)}`, err.message ?? String(err));
  }
}

module.exports = {
  getConfig,
  getClients,
  _resetForTest,
  sendTx,
  fetchValue,
  waitForTransaction,
  // scVal helpers
  addressScVal,
  stringScVal,
  u32ScVal,
  u64ScVal,
  symbolScVal,
  bytesN32ScVal,
  enumScVal,
  safeValue,
  // re-exports used by the real adapter
  Keypair,
};
