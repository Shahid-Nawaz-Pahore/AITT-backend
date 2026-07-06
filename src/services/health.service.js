// src/services/health.service.js
// ---------------------------------------------------------------------------
// Liveness/readiness checks (D10).
//   /health  — liveness: the process is up (no dependency checks).
//   /ready   — readiness: Mongo connected + (in real mode) Soroban RPC reachable,
//              plus outbox backlog info. A load balancer routes traffic only when
//              /ready is 200; a failing dependency returns 503.
// The RPC probe is bounded (timeout) and its result cached briefly so a /ready
// poll storm never hammers the RPC endpoint.
// ---------------------------------------------------------------------------
const mongoose = require('mongoose');
const { selectedAdapter } = require('../config/env');
const logger = require('../utils/logger');

const RPC_CACHE_MS = 5000;
let _rpcCache = { at: 0, ok: null, error: null };

function mongoConnected() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

async function checkRpc({ timeoutMs = 3000, now = Date.now() } = {}) {
  // Only meaningful in real mode (stub has no chain).
  if (selectedAdapter() !== 'real') return { checked: false, ok: true };

  if (_rpcCache.ok !== null && now - _rpcCache.at < RPC_CACHE_MS) {
    return { checked: true, ok: _rpcCache.ok, cached: true, error: _rpcCache.error };
  }

  try {
    // eslint-disable-next-line global-require
    const rpc = require('./sorobanAdapter/rpc');
    const { server } = rpc.getClients();
    const probe = typeof server.getHealth === 'function'
      ? server.getHealth()
      : server.getLatestLedger();
    await Promise.race([
      probe,
      new Promise((_, reject) => setTimeout(() => reject(new Error('RPC probe timed out')), timeoutMs)),
    ]);
    _rpcCache = { at: now, ok: true, error: null };
    return { checked: true, ok: true };
  } catch (err) {
    _rpcCache = { at: now, ok: false, error: err.message };
    logger.warn('readiness: RPC probe failed', { error: err.message });
    return { checked: true, ok: false, error: err.message };
  }
}

async function outboxBacklog() {
  try {
    // eslint-disable-next-line global-require
    const { pendingCount, deadLetterCount } = require('./outbox.service');
    if (!mongoConnected()) return { pending: null, deadLetter: null };
    const [pending, deadLetter] = await Promise.all([pendingCount(), deadLetterCount()]);
    return { pending, deadLetter };
  } catch (e) {
    return { pending: null, deadLetter: null };
  }
}

/** readiness() — full dependency check for /ready. */
async function readiness() {
  const mongo = mongoConnected();
  const [rpc, outbox] = await Promise.all([checkRpc(), outboxBacklog()]);
  const ready = !!mongo && rpc.ok;
  return {
    ready,
    checks: {
      mongo: mongo ? 'up' : 'down',
      rpc: rpc.checked ? (rpc.ok ? 'up' : 'down') : 'n/a',
    },
    adapter: selectedAdapter(),
    outbox,
    rpcError: rpc.ok ? undefined : rpc.error,
  };
}

// Test hook: clear the RPC probe cache.
function _resetRpcCache() { _rpcCache = { at: 0, ok: null, error: null }; }

module.exports = { readiness, checkRpc, mongoConnected, _resetRpcCache };
