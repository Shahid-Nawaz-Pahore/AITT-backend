// __tests__/security.h1.app.test.js
// App-level (supertest) regression tests for Phase H1 fixes. None of these hit
// Mongo — they assert routing/auth/sanitization behavior before any DB access.
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
const request = require('supertest');
const app = require('../src/app');

describe('H1 #1 — public static document mount removed', () => {
  it('GET /certificates/<file> is 404 (no public file serving)', async () => {
    const res = await request(app).get('/certificates/confidential-report.pdf');
    expect(res.status).toBe(404);
  });

  it('the authed file endpoint denies unauthenticated access (401)', async () => {
    const res = await request(app).get('/api/v1/documents/anyid/file');
    expect(res.status).toBe(401);
  });
});

describe('H1 folded audit criticals — unauthenticated privileged routes guarded', () => {
  it('C1: POST /auth/register requires auth (401 without token)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email: 'evil@x.io', role: 'super_admin', password: 'x' });
    expect(res.status).toBe(401);
  });

  it('C3: GET /certificates/admin/all requires auth (401 without token)', async () => {
    const res = await request(app).get('/api/v1/certificates/admin/all');
    expect(res.status).toBe(401);
  });
});

describe('H1 #8 — NoSQL operator injection neutralized', () => {
  it('login with operator-object credentials is rejected (no auth bypass)', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
    // mongo-sanitize strips the $ne keys -> email becomes a non-string -> 400.
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.status).not.toBe(200);
  });
});
