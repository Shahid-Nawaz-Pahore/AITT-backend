// __tests__/security.e.app.test.js
// Access-control fixes from the adversarial re-audit (E). App-level supertest,
// no Mongo — auth rejects before any DB access.
process.env.SOROBAN_ADAPTER = process.env.SOROBAN_ADAPTER || 'stub';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-secret';

const request = require('supertest');
const app = require('../src/app');

describe('E-audit — broken access control fixes', () => {
  it('H1: GET /certificates/:id now REQUIRES auth (was anonymous, leaked PII)', async () => {
    const res = await request(app).get('/api/v1/certificates/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });

  it('H2: POST /certificates/check now REQUIRES auth (was an unauth OOM DoS)', async () => {
    const res = await request(app).post('/api/v1/certificates/check');
    expect(res.status).toBe(401);
  });
});
