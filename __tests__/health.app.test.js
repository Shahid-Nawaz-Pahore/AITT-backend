// __tests__/health.app.test.js
// Liveness/readiness endpoints (D10). App-level supertest — no Mongo connection,
// so /ready must report Mongo down (503) while /health (liveness) stays 200.
process.env.SOROBAN_ADAPTER = process.env.SOROBAN_ADAPTER || 'stub';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-secret';

const request = require('supertest');
const app = require('../src/app');

describe('GET /health (liveness)', () => {
  it('returns 200 and ok regardless of dependencies', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });
});

describe('GET /ready (readiness)', () => {
  it('returns 503 when Mongo is not connected', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.ready).toBe(false);
    expect(res.body.checks.mongo).toBe('down');
    // In stub mode the RPC check is not applicable.
    expect(res.body.checks.rpc).toBe('n/a');
  });
});
