// __tests__/extras.p5.int.test.js
// P5 extras: .docx generation, templates CRUD+download, frameworks (read-only),
// alerts, the expiry job, notifications, and the seed.
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Certificate = require('../src/models/Certificate');
const Alert = require('../src/models/Alert');
const Notification = require('../src/models/Notification');

const { buildDocx } = require('../src/utils/docx');
const { notify } = require('../src/utils/notify');
const templateService = require('../src/services/template.service');
const frameworkService = require('../src/services/framework.service');
const alertService = require('../src/services/alert.service');
const notificationService = require('../src/services/notification.service');
const { runExpiryJob } = require('../src/services/jobs/expiry.job');
const { runSeed } = require('../src/migrations/seed-p5');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'testdb' });
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongoServer) await mongoServer.stop();
});
beforeEach(async () => {
  for (const k in mongoose.connection.collections) await mongoose.connection.collections[k].deleteMany({});
});

describe('docx generator', () => {
  it('produces a valid ZIP (.docx) buffer', () => {
    const buf = buildDocx({ title: 'T', paragraphs: ['a', 'b'] });
    expect(buf.length).toBeGreaterThan(100);
    expect(buf.slice(0, 4).toString('hex')).toBe('504b0304'); // PK\x03\x04
    expect(buf.slice(-22, -18).toString('hex')).toBe('504b0506'); // EOCD
  });
});

describe('templates CRUD + .docx download', () => {
  it('creates, lists, updates, downloads, removes', async () => {
    const t = await templateService.createTemplate({ name: 'Audit Report', description: 'blank' });
    expect(t).toMatchObject({ name: 'Audit Report', file: 'audit-report.docx' });

    const list = await templateService.listTemplates({});
    expect(list.pagination.total).toBe(1);

    const updated = await templateService.updateTemplate(t.id, { description: 'updated' });
    expect(updated.description).toBe('updated');

    const dl = await templateService.buildDownload(t.id);
    expect(dl.filename).toBe('audit-report.docx');
    expect(dl.mimeType).toMatch(/wordprocessingml/);
    expect(dl.buffer.slice(0, 4).toString('hex')).toBe('504b0304');

    await templateService.removeTemplate(t.id);
    await expect(templateService.getTemplate(t.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('frameworks read-only', () => {
  it('lists active frameworks (no direct create endpoint)', async () => {
    await runSeed();
    const list = await frameworkService.listFrameworks({});
    expect(list.pagination.total).toBeGreaterThanOrEqual(5);
    expect(typeof frameworkService.createFramework).toBe('undefined'); // writes go via governance only
  });
});

describe('alerts', () => {
  it('creates, lists unresolved, resolves', async () => {
    const a = await alertService.createAlert({ docId: new mongoose.Types.ObjectId(), message: 'expiring', dueDate: new Date(), severity: 'warning' });
    let list = await alertService.listAlerts({});
    expect(list.pagination.total).toBe(1);

    await alertService.resolveAlert(a.id);
    list = await alertService.listAlerts({}); // unresolved only by default
    expect(list.pagination.total).toBe(0);
    const all = await alertService.listAlerts({ includeResolved: true });
    expect(all.pagination.total).toBe(1);
  });
});

describe('expiry job', () => {
  async function makeCert({ name, daysFromNow, status = 'issued', user = null }) {
    return Certificate.create({
      certificateName: name, subject: 's', metadataHash: name.padEnd(64, '0').slice(0, 64),
      status, chain: { certificateStatus: 'Issued' },
      expiryAt: new Date(Date.now() + daysFromNow * 24 * 3600 * 1000),
      requestedByUserId: user,
    });
  }

  it('expires past-due certs (+ critical alert + notification) and warns upcoming; idempotent', async () => {
    const user = new mongoose.Types.ObjectId();
    await makeCert({ name: 'past', daysFromNow: -1, user });
    await makeCert({ name: 'soon', daysFromNow: 10 });
    await makeCert({ name: 'far', daysFromNow: 60 });

    const r1 = await runExpiryJob({ warnWithinDays: 30 });
    expect(r1.expired).toBe(1);
    expect(r1.warned).toBe(1);

    expect((await Certificate.findOne({ certificateName: 'past' })).status).toBe('expired');
    expect((await Alert.countDocuments({ severity: 'critical', kind: 'expiry' }))).toBe(1);
    expect((await Alert.countDocuments({ severity: 'warning', kind: 'expiry' }))).toBe(1);
    expect((await Notification.countDocuments({ userId: user, type: 'expiry' }))).toBe(1);

    // Idempotent: second run expires nothing new and creates no duplicate alerts.
    const r2 = await runExpiryJob({ warnWithinDays: 30 });
    expect(r2.expired).toBe(0);
    expect(r2.alertsCreated).toBe(0);
    expect((await Alert.countDocuments({ kind: 'expiry' }))).toBe(2);
  });
});

describe('notifications', () => {
  it('notify creates, list reports unread, markRead clears it', async () => {
    const userId = new mongoose.Types.ObjectId();
    await notify({ userId, type: 'success', title: 'Issued', message: 'done', entityType: 'document', entityId: 'd1' });
    await notify({ userId, type: 'info', title: 'Hi' });

    let list = await notificationService.listNotifications({ userId });
    expect(list.pagination.total).toBe(2);
    expect(list.unread).toBe(2);

    await notificationService.markRead(list.data[0].id, userId);
    list = await notificationService.listNotifications({ userId });
    expect(list.unread).toBe(1);

    await notificationService.markAllRead(userId);
    list = await notificationService.listNotifications({ userId });
    expect(list.unread).toBe(0);
  });
});

describe('seed-p5', () => {
  it('is idempotent', async () => {
    const first = await runSeed();
    expect(first.frameworks).toBeGreaterThan(0);
    const second = await runSeed();
    expect(second.frameworks).toBe(0); // already seeded
    expect(second.templates).toBe(0);
  });
});
