// src/middlewares/rateLimiters.js
// ---------------------------------------------------------------------------
// Per-route rate limiters (audit #5). The global limiter in app.js (200/15min)
// is far too loose for credential endpoints. `loginLimiter` is a strict per-IP
// limiter that only counts FAILED attempts (skipSuccessfulRequests), so normal
// users are unaffected but brute-force is throttled. `sensitiveLimiter` guards
// register / refresh / api-key exchange.
//
// Per-IP is the first line; per-ACCOUNT lockout (auth.service.login) is the
// second, to defend distributed brute-force from many IPs against one account.
// ---------------------------------------------------------------------------
const rateLimit = require('express-rate-limit');

const json429 = (req, res) =>
  res.status(429).json({ success: false, message: 'Too many requests, please try again later' });

const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.LOGIN_RATE_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed logins count toward the limit
  handler: json429,
});

const sensitiveLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_RATE_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.AUTH_RATE_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
  handler: json429,
});

module.exports = { loginLimiter, sensitiveLimiter };
