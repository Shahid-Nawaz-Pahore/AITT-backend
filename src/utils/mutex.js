// src/utils/mutex.js
// ---------------------------------------------------------------------------
// Keyed async mutex — serialize async operations that share a key. Used to
// serialize all signed transactions from a single Stellar account (H4 #13): a
// Stellar account's sequence number is inherently serial, so two concurrent
// custodial submits from the same key race on the sequence and one gets
// tx_bad_seq. Serializing per signer key eliminates that contention proactively
// (the rpc-layer bad_seq retry remains as a reactive backstop).
// ---------------------------------------------------------------------------
const tails = new Map(); // key -> promise of the last-queued operation (errors swallowed)

/**
 * runExclusive(key, fn) — run fn only after all previously-queued ops for `key`
 * have settled. Returns fn's real result/error; the internal queue swallows
 * errors so one failure doesn't wedge the chain. Map entries self-clean.
 */
function runExclusive(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
  const result = prev.then(fn, fn); // wait for prior (ignore its outcome), then run fn
  const tail = result.catch(() => {});
  tails.set(key, tail);
  tail.finally(() => { if (tails.get(key) === tail) tails.delete(key); });
  return result;
}

module.exports = { runExclusive };
