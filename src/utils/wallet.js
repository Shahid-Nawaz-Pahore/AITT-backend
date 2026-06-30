// src/utils/wallet.js
// ---------------------------------------------------------------------------
// Custodial key management (A2, one key per officer/company — confirmed P2).
// The backend generates a Stellar keypair per Company / SubAdmin and stores the
// secret ENCRYPTED at rest, so it can sign that party's on-chain txs (e.g. a
// sub-admin's submit_review / approve_proposal) while preserving per-signer
// identity in the multi-sig. Designed to be swappable for browser signing
// (Freighter) later — callers only ever ask for a signer secret via decrypt().
//
// Encryption: AES-256-GCM with a key derived from KEY_ENCRYPTION_SECRET. If that
// env is unset (dev/test), secrets are stored with a `plain:` marker and a loud
// warning — never do that in production.
// Import-safe: no env is read until a function is called.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const { Keypair } = require('@stellar/stellar-sdk');
const logger = require('./logger');

function deriveKey() {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  if (!secret) return null;
  return crypto.createHash('sha256').update(String(secret)).digest(); // 32 bytes
}

/** Generate a fresh Stellar keypair. */
function generateWallet() {
  const kp = Keypair.random();
  return { publicKey: kp.publicKey(), secret: kp.secret() };
}

/** Encrypt a secret for at-rest storage. Returns an opaque string. */
function encryptSecret(secret) {
  if (secret == null) return null;
  const key = deriveKey();
  if (!key) {
    // Never allow unencrypted custodial secrets in production.
    if (String(process.env.NODE_ENV).toLowerCase() === 'production') {
      throw new Error('KEY_ENCRYPTION_SECRET must be set in production to encrypt custodial secrets');
    }
    logger.warn('KEY_ENCRYPTION_SECRET not set — storing custodial secret UNENCRYPTED (dev only)');
    return `plain:${secret}`;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/** Decrypt a stored secret back to its plaintext (for signing). */
function decryptSecret(stored) {
  if (stored == null) return null;
  if (stored.startsWith('plain:')) return stored.slice('plain:'.length);
  if (stored.startsWith('gcm:')) {
    const key = deriveKey();
    if (!key) throw new Error('KEY_ENCRYPTION_SECRET required to decrypt custodial secret');
    const [, ivHex, tagHex, dataHex] = stored.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  }
  // Unknown format — assume already-plaintext secret.
  return stored;
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
};
