// src/utils/wallet.js
// ---------------------------------------------------------------------------
// Custodial key management (A2, one key per officer/company — confirmed P2).
// The backend generates a Stellar keypair per Company / SubAdmin and stores the
// secret ENCRYPTED at rest, so it can sign that party's on-chain txs (e.g. a
// sub-admin's submit_review / approve_proposal) while preserving per-signer
// identity in the multi-sig. Designed to be swappable for browser signing
// (Freighter) later — callers only ever ask for a signer secret via decrypt().
//
// Encryption format (VERSIONED — H2 #3):
//   gcm:v1:<ivHex>:<tagHex>:<cipherHex>   AES-256-GCM, key = sha256(KEY_ENCRYPTION_SECRET)
//   gcm:<ivHex>:<tagHex>:<cipherHex>      LEGACY (unversioned) — still decryptable
//   plain:<secret>                        dev/test only (loud warning; hard-fails in prod)
// The version tag lets us evolve the KDF/cipher and migrate ciphertext via
// rotateKey() without a flag-day. Import-safe: no env is read until a call.
//
// KMS SEAM (infra TODO, clean boundary): getDataKey() is the ONLY place a raw
// data key is produced. To move to a managed KMS (AWS KMS / GCP KMS / Vault),
// implement getDataKey() to call KMS Decrypt/GenerateDataKey and keep the rest
// unchanged — the ciphertext format already carries a version tag for the new
// scheme (e.g. 'gcm:v2:<encryptedDataKey>:<iv>:<tag>:<cipher>'). No caller changes.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const { Keypair } = require('@stellar/stellar-sdk');
const logger = require('./logger');

const CIPHER_VERSION = 'v1';

// KMS SEAM: derive the 32-byte data key. Today: sha256(KEY_ENCRYPTION_SECRET).
// Swap this for a KMS-backed key without touching encrypt/decrypt callers.
function getDataKey(secretOverride = null) {
  const secret = secretOverride != null ? secretOverride : process.env.KEY_ENCRYPTION_SECRET;
  if (!secret) return null;
  return crypto.createHash('sha256').update(String(secret)).digest(); // 32 bytes
}

// Back-compat alias kept for any external callers/tests.
function deriveKey() {
  return getDataKey();
}

/** Generate a fresh Stellar keypair. */
function generateWallet() {
  const kp = Keypair.random();
  return { publicKey: kp.publicKey(), secret: kp.secret() };
}

// Guard against silently storing a custodial secret in plaintext (audit C2).
// - production: ALWAYS requires KEY_ENCRYPTION_SECRET (hard fail).
// - dev: refuses plaintext UNLESS ALLOW_PLAINTEXT_KEYS=true is explicitly set.
// - test: plaintext allowed (at-rest encryption isn't under test there).
function assertKeyOrPlaintextAllowed(key) {
  if (key) return;
  const env = String(process.env.NODE_ENV).toLowerCase();
  if (env === 'production') {
    throw new Error('KEY_ENCRYPTION_SECRET must be set in production to encrypt custodial secrets');
  }
  const allowPlain = env === 'test' || String(process.env.ALLOW_PLAINTEXT_KEYS).toLowerCase() === 'true';
  if (!allowPlain) {
    throw new Error('KEY_ENCRYPTION_SECRET is not set — refusing to store a custodial secret in plaintext. Set KEY_ENCRYPTION_SECRET (recommended), or set ALLOW_PLAINTEXT_KEYS=true to explicitly opt into insecure dev storage.');
  }
}

/** Encrypt a secret for at-rest storage. Returns an opaque, versioned string. */
function encryptSecret(secret, keyOverride = null) {
  if (secret == null) return null;
  const key = keyOverride || getDataKey();
  assertKeyOrPlaintextAllowed(key);
  if (!key) {
    logger.warn('KEY_ENCRYPTION_SECRET not set — storing custodial secret UNENCRYPTED (dev opt-in via ALLOW_PLAINTEXT_KEYS)');
    return `plain:${secret}`;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm:${CIPHER_VERSION}:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

// Decrypt a gcm blob (versioned or legacy) with the given 32-byte key.
function decryptGcm(stored, key) {
  if (!key) throw new Error('KEY_ENCRYPTION_SECRET required to decrypt custodial secret');
  const parts = stored.split(':');
  // Versioned: gcm:v1:iv:tag:data  (5) ; Legacy: gcm:iv:tag:data (4)
  let ivHex, tagHex, dataHex;
  if (parts.length === 5 && parts[1] === CIPHER_VERSION) {
    [, , ivHex, tagHex, dataHex] = parts;
  } else if (parts.length === 4) {
    [, ivHex, tagHex, dataHex] = parts;
  } else {
    throw new Error('Unrecognized gcm ciphertext format');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

/** Decrypt a stored secret back to its plaintext (for signing). */
function decryptSecret(stored, keyOverride = null) {
  if (stored == null) return null;
  if (stored.startsWith('plain:')) return stored.slice('plain:'.length);
  if (stored.startsWith('gcm:')) return decryptGcm(stored, keyOverride || getDataKey());
  // Unknown format — assume already-plaintext secret.
  return stored;
}

/**
 * rotateKey(stored, { oldSecret, newSecret }) — re-encrypt a stored secret under
 * a new key (key rotation seam). Decrypts with the OLD key (defaults to the
 * current KEY_ENCRYPTION_SECRET) and re-encrypts (always to the current version)
 * with the NEW key. Returns the new opaque ciphertext. Used by an ops rotation
 * script that walks Company/SubAdmin.walletSecretEnc.
 */
function rotateKey(stored, { oldSecret = null, newSecret = null } = {}) {
  if (stored == null) return null;
  const oldKey = oldSecret != null ? getDataKey(oldSecret) : getDataKey();
  const plaintext = decryptSecret(stored, oldKey);
  const newKey = newSecret != null ? getDataKey(newSecret) : getDataKey();
  return encryptSecret(plaintext, newKey);
}

/** Generate a wallet and return { publicKey, secretEnc } ready for persistence. */
function generateCustodialWallet() {
  const { publicKey, secret } = generateWallet();
  return { publicKey, secretEnc: encryptSecret(secret) };
}

module.exports = {
  generateWallet,
  generateCustodialWallet,
  encryptSecret,
  decryptSecret,
  rotateKey,
  getDataKey,
  deriveKey, // back-compat
  CIPHER_VERSION,
};
