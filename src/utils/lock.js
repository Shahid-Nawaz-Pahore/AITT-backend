// src/utils/lock.js
// ---------------------------------------------------------------------------
// withLock(name, leaseMs, fn) — run `fn` only if we can acquire the named
// lease-based lock (models/JobLock). Returns { ran, result } — ran=false when
// another instance holds a live lease. The lease is released (or its lastRunAt
// stamped) when fn settles; an expired lease is reclaimable by anyone, so a
// crash can never wedge the lock. Multi-instance safe (D12).
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const JobLock = require('../models/JobLock');
const logger = require('./logger');

// Stable-ish per-process owner id (host pid + random) — only used for observability.
const OWNER_ID = `${process.pid}-${crypto.randomBytes(3).toString('hex')}`;

/**
 * acquireLock(name, leaseMs, now) — atomically claim `name` if it is free or its
 * lease has expired. Returns true on success. Uses a single conditional
 * findOneAndUpdate so two instances racing can't both win.
 */
async function acquireLock(name, leaseMs, now = new Date()) {
  const lockedUntil = new Date(now.getTime() + leaseMs);
  try {
    const res = await JobLock.findOneAndUpdate(
      { name, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
      { $set: { owner: OWNER_ID, lockedUntil }, $setOnInsert: { name } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    return !!res && res.owner === OWNER_ID;
  } catch (err) {
    // Duplicate-key (11000) means another instance won the upsert race — not ours.
    if (err && err.code === 11000) return false;
    throw err;
  }
}

/** releaseLock(name) — free the lock and stamp lastRunAt (best-effort). */
async function releaseLock(name, now = new Date()) {
  try {
    await JobLock.updateOne(
      { name, owner: OWNER_ID },
      { $set: { lockedUntil: new Date(0), lastRunAt: now } },
    );
  } catch (err) {
    logger.warn('releaseLock failed', { name, error: err.message });
  }
}

async function withLock(name, leaseMs, fn) {
  const got = await acquireLock(name, leaseMs);
  if (!got) {
    logger.debug('withLock: lease held by another instance, skipping', { name });
    return { ran: false, result: null };
  }
  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    await releaseLock(name);
  }
}

module.exports = { withLock, acquireLock, releaseLock, OWNER_ID };
