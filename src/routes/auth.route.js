const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const { loginLimiter, sensitiveLimiter } = require('../middlewares/rateLimiters');

// SECURITY (audit C1): registration is NO LONGER public — it created privileged
// accounts (incl. the first super_admin) with the role taken from the body.
// Only an authenticated super_admin may create users. Bootstrap the initial
// super_admin out-of-band: `node src/migrations/seed-admin.js`.
router.post('/register', requireAuth(['super_admin']), authController.register);

// SECURITY (audit #5): strict per-route limiter on credential endpoints.
router.post('/login', loginLimiter, authController.login);
router.post('/refresh', sensitiveLimiter, authController.refresh);
router.post('/exchange-key', sensitiveLimiter, authController.exchangeApiKey);

module.exports = router;
