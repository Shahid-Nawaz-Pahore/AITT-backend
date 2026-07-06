// __tests__/storage.int.test.js
// Pluggable file storage (H4 #11) — round-trip across disk / gridfs / memory.
const os = require('os');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const storage = require('../src/services/storage.service');

const ENV = { ...process.env };
const CONTENT = Buffer.from('PDF-CONTENT-🌍-' + 'x'.repeat(500), 'utf8');

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

let mongoServer;
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'storagetest' });
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongoServer) await mongoServer.stop();
  process.env = { ...ENV };
});
afterEach(() => { process.env = { ...ENV }; });

describe('memory driver', () => {
  it('round-trips a buffer', async () => {
    process.env.STORAGE_DRIVER = 'memory';
    const desc = await storage.saveBuffer(CONTENT, { filename: 'a.pdf', mimeType: 'application/pdf' });
    expect(desc.provider).toBe('memory');
    const { stream, mimeType } = await storage.getStream(desc);
    expect(mimeType).toBe('application/pdf');
    expect((await streamToBuffer(stream)).equals(CONTENT)).toBe(true);
    await storage.remove(desc);
    await expect(storage.getStream(desc)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('disk driver', () => {
  it('round-trips a buffer and cleans up', async () => {
    process.env.STORAGE_DRIVER = 'disk';
    process.env.UPLOAD_BASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aitt-store-'));
    const desc = await storage.saveBuffer(CONTENT, { filename: 'b.pdf', mimeType: 'application/pdf' });
    expect(desc.provider).toBe('disk');
    expect(fs.existsSync(desc.path)).toBe(true);
    const { stream } = await storage.getStream(desc);
    expect((await streamToBuffer(stream)).equals(CONTENT)).toBe(true);
    await storage.remove(desc);
    expect(fs.existsSync(desc.path)).toBe(false);
  });
});

describe('gridfs driver (auto when Mongo connected)', () => {
  it('round-trips a buffer across a shared datastore', async () => {
    process.env.STORAGE_DRIVER = 'auto'; // -> gridfs (mongo connected)
    expect(storage.resolveDriver()).toBe('gridfs');
    const desc = await storage.saveBuffer(CONTENT, { filename: 'c.pdf', mimeType: 'application/pdf' });
    expect(desc.provider).toBe('gridfs');
    expect(desc.key).toBeTruthy();
    const { stream, filename } = await storage.getStream(desc);
    expect(filename).toBe('c.pdf');
    expect((await streamToBuffer(stream)).equals(CONTENT)).toBe(true);
    await storage.remove(desc);
    await expect(storage.getStream(desc)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects empty files', async () => {
    await expect(storage.saveBuffer(Buffer.alloc(0), {})).rejects.toMatchObject({ statusCode: 400 });
  });
});
