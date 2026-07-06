// __tests__/wallet.versioning.unit.test.js
// Custodial key encryption versioning + rotation (H2 #3).
const crypto = require('crypto');
const wallet = require('../src/utils/wallet');

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; });

describe('encryptSecret / decryptSecret — versioned gcm', () => {
  it('produces a gcm:v1: ciphertext and round-trips', () => {
    process.env.KEY_ENCRYPTION_SECRET = 'unit-test-encryption-key';
    const enc = wallet.encryptSecret('SABCDEF');
    expect(enc.startsWith('gcm:v1:')).toBe(true);
    expect(enc).not.toContain('SABCDEF'); // not stored in the clear
    expect(wallet.decryptSecret(enc)).toBe('SABCDEF');
  });

  it('still decrypts a LEGACY (unversioned) gcm blob', () => {
    process.env.KEY_ENCRYPTION_SECRET = 'legacy-key';
    // Hand-build a pre-versioning ciphertext: gcm:<iv>:<tag>:<data>
    const key = crypto.createHash('sha256').update('legacy-key').digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update('SLEGACY', 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const legacy = `gcm:${iv.toString('hex')}:${tag.toString('hex')}:${data.toString('hex')}`;
    expect(wallet.decryptSecret(legacy)).toBe('SLEGACY');
  });

  it('falls back to plain: in dev ONLY with the explicit opt-in, and round-trips', () => {
    delete process.env.KEY_ENCRYPTION_SECRET;
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_PLAINTEXT_KEYS = 'true';
    const enc = wallet.encryptSecret('SPLAIN');
    expect(enc).toBe('plain:SPLAIN');
    expect(wallet.decryptSecret(enc)).toBe('SPLAIN');
  });

  it('refuses plaintext in dev WITHOUT the opt-in (audit C2)', () => {
    delete process.env.KEY_ENCRYPTION_SECRET;
    delete process.env.ALLOW_PLAINTEXT_KEYS;
    process.env.NODE_ENV = 'development';
    expect(() => wallet.encryptSecret('SX')).toThrow(/refusing to store a custodial secret in plaintext/);
  });

  it('hard-fails in production when no key is set', () => {
    delete process.env.KEY_ENCRYPTION_SECRET;
    process.env.NODE_ENV = 'production';
    expect(() => wallet.encryptSecret('SX')).toThrow(/KEY_ENCRYPTION_SECRET must be set in production/);
  });
});

describe('rotateKey — re-encrypt under a new key', () => {
  it('re-encrypts so the NEW key decrypts and the OLD key fails', () => {
    process.env.KEY_ENCRYPTION_SECRET = 'old-key';
    const enc = wallet.encryptSecret('SROTATE');

    const rotated = wallet.rotateKey(enc, { oldSecret: 'old-key', newSecret: 'new-key' });
    expect(rotated.startsWith('gcm:v1:')).toBe(true);

    // New key decrypts.
    expect(wallet.decryptSecret(rotated, wallet.getDataKey('new-key'))).toBe('SROTATE');
    // Old key no longer works (auth tag / key mismatch throws).
    expect(() => wallet.decryptSecret(rotated, wallet.getDataKey('old-key'))).toThrow();
  });
});

describe('generateCustodialWallet', () => {
  it('returns a public key and an encrypted secret', () => {
    process.env.KEY_ENCRYPTION_SECRET = 'k';
    const w = wallet.generateCustodialWallet();
    expect(w.publicKey).toMatch(/^G[A-Z0-9]{55}$/);
    expect(w.secretEnc.startsWith('gcm:v1:')).toBe(true);
    expect(wallet.decryptSecret(w.secretEnc)).toMatch(/^S[A-Z0-9]{55}$/);
  });
});
