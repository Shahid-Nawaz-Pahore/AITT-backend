// src/utils/validation.js
// Input validation for account creation: strict-ish email format, a disposable/
// throwaway-domain blocklist, and password strength. Throws AppError(400) with a
// clear, client-facing message.
//
// NOTE: this rejects malformed and throwaway emails, but does not prove the
// registrant OWNS the address — full ownership proof needs OTP/link verification.
// (An MX/DNS check was intentionally removed: DNS is unreliable on serverless and
// was false-rejecting real domains like gmail.com, which would block real users.)
const AppError = require('./AppError');

// local@domain.tld — no spaces, a dot in the domain, TLD >= 2 chars.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Common disposable / throwaway email providers — rejected outright.
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', 'temp-mail.org', 'temp-mail.io', '10minutemail.com',
  'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com', 'yopmail.com', 'yopmail.net',
  'trashmail.com', 'trashmail.net', 'getnada.com', 'nada.email', 'maildrop.cc',
  'throwawaymail.com', 'fakeinbox.com', 'dispostable.com', 'mailnesia.com', 'mintemail.com',
  'mohmal.com', 'tempinbox.com', 'emailondeck.com', 'moakt.com', 'discard.email',
  'spam4.me', 'grr.la', 'tempr.email', 'burnermail.io', 'mailto.plus', 'fakemail.net',
  '1secmail.com', 'mailsac.com', 'tmpmail.org', 'trashmail.io', 'test.com',
]);

function assertValidEmail(email) {
  const e = String(email || '').trim();
  if (e.length > 254 || !EMAIL_RE.test(e)) {
    throw new AppError(400, 'Please provide a valid email address.');
  }
  return e.toLowerCase();
}

// At least 8 chars, with at least one letter and one number.
function assertValidPassword(password) {
  const pw = String(password || '');
  if (pw.length < 8) {
    throw new AppError(400, 'Password must be at least 8 characters long.');
  }
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    throw new AppError(400, 'Password must include at least one letter and one number.');
  }
  return pw;
}

// Format + not a disposable/throwaway domain. Blocks obviously fake emails at
// registration without a network dependency.
function assertDeliverableEmail(email) {
  const e = assertValidEmail(email); // format + lowercase (throws on bad format)
  const domain = e.split('@')[1];
  if (DISPOSABLE_DOMAINS.has(domain)) {
    throw new AppError(400, 'Disposable or temporary email addresses are not allowed. Please use a real email address.');
  }
  return e;
}

module.exports = { assertValidEmail, assertValidPassword, assertDeliverableEmail, EMAIL_RE, DISPOSABLE_DOMAINS };
