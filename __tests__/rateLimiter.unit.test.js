// __tests__/rateLimiter.unit.test.js
// H1 #5 — the login limiter must 429 after N failed attempts. Isolated mini-app
// (no Mongo); LOGIN_RATE_MAX set before the module loads.
process.env.LOGIN_RATE_MAX = '3';
const express = require('express');
const request = require('supertest');
const { loginLimiter } = require('../src/middlewares/rateLimiters');

const app = express();
app.use(express.json());
// Simulate a failing login handler (401) so skipSuccessfulRequests counts it.
app.post('/login', loginLimiter, (req, res) => res.status(401).json({ success: false, message: 'bad creds' }));

describe('loginLimiter', () => {
  it('allows up to N failed attempts then returns 429', async () => {
    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app).post('/login').send({ email: 'a@b.io', password: 'wrong' });
      expect(r.status).toBe(401);
    }
    const blocked = await request(app).post('/login').send({ email: 'a@b.io', password: 'wrong' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);
  });
});
