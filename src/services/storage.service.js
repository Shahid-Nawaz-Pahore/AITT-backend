// src/services/storage.service.js
// ---------------------------------------------------------------------------
// Pluggable file storage (H4 #11). Uploaded compliance documents must survive a
// multi-instance deploy, so local disk is no longer the only option:
//
//   STORAGE_DRIVER = auto | disk | gridfs | memory
//     gridfs  — stored in Mongo (GridFS) → survives across instances (RECOMMENDED
//               default when Mongo is connected).
//     disk    — local filesystem (single-instance / dev; kept as one impl).
//     memory  — in-process (tests / ephemeral).
//     auto    — gridfs if Mongo is connected, else disk.
//
// The interface is driver-agnostic: saveBuffer() returns an opaque descriptor
// persisted on the Certificate; getStream() resolves it back to a readable
// stream. Adding S3/MinIO later means implementing these two functions for a new
// provider — no call-site changes (the "S3-style abstraction" seam).
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const memoryStore = new Map(); // key -> { buffer, mimeType, filename }
const GRIDFS_BUCKET = 'uploads';

function resolveDriver() {
  const explicit = String(process.env.STORAGE_DRIVER || 'auto').toLowerCase();
  if (['disk', 'gridfs', 'memory'].includes(explicit)) return explicit;
  // auto: prefer GridFS when Mongo is connected (multi-instance safe), else disk.
  if (mongoose.connection && mongoose.connection.readyState === 1) return 'gridfs';
  return 'disk';
}

function gridfsBucket() {
  const db = mongoose.connection && mongoose.connection.db;
  if (!db) throw new AppError(503, 'GridFS unavailable: Mongo is not connected');
  return new mongoose.mongo.GridFSBucket(db, { bucketName: GRIDFS_BUCKET });
}

function diskDir() {
  const base = process.env.UPLOAD_BASE_DIR || path.join(process.cwd(), 'uploads');
  const dir = path.join(base, process.env.CERT_UPLOAD_DIR || 'certificates');
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  return dir;
}

/**
 * saveBuffer(buffer, { filename, mimeType }) → storage descriptor
 * { provider, key, path?, size, filename, mimeType }
 */
async function saveBuffer(buffer, { filename = 'file', mimeType = 'application/octet-stream' } = {}) {
  if (!buffer || !buffer.length) throw new AppError(400, 'Cannot store an empty file');
  const driver = resolveDriver();
  const size = buffer.length;

  if (driver === 'memory') {
    const key = crypto.randomBytes(16).toString('hex');
    memoryStore.set(key, { buffer, mimeType, filename });
    return { provider: 'memory', key, size, filename, mimeType };
  }

  if (driver === 'gridfs') {
    const bucket = gridfsBucket();
    const key = await new Promise((resolve, reject) => {
      const up = bucket.openUploadStream(filename, { contentType: mimeType, metadata: { mimeType } });
      Readable.from(buffer).pipe(up).on('error', reject).on('finish', () => resolve(String(up.id)));
    });
    logger.info('storage: saved to GridFS', { key, size });
    return { provider: 'gridfs', key, size, filename, mimeType };
  }

  // disk
  const dir = diskDir();
  const ext = path.extname(filename).slice(0, 20) || '';
  const key = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const full = path.join(dir, key);
  fs.writeFileSync(full, buffer, { mode: 0o640 });
  return { provider: 'disk', key, path: full, size, filename, mimeType };
}

/**
 * getStream(descriptor) → { stream, mimeType, filename } — resolve a stored file
 * to a readable stream. Throws 404 if the descriptor points to nothing.
 * Accepts the legacy shape { provider:'local', path } too.
 */
async function getStream(desc) {
  if (!desc || (!desc.provider && !desc.path)) throw new AppError(404, 'No stored file available for this document');
  const provider = desc.provider === 'local' ? 'disk' : desc.provider;

  if (provider === 'memory') {
    const rec = memoryStore.get(desc.key);
    if (!rec) throw new AppError(404, 'Stored file not found');
    return { stream: Readable.from(rec.buffer), mimeType: rec.mimeType, filename: rec.filename };
  }

  if (provider === 'gridfs') {
    const bucket = gridfsBucket();
    let id;
    try { id = new mongoose.mongo.ObjectId(desc.key); } catch (e) { throw new AppError(404, 'Invalid file key'); }
    const files = await bucket.find({ _id: id }).limit(1).toArray();
    if (!files.length) throw new AppError(404, 'Stored file not found');
    return { stream: bucket.openDownloadStream(id), mimeType: desc.mimeType || files[0].contentType, filename: desc.filename || files[0].filename };
  }

  // disk (or legacy 'local')
  const p = desc.path;
  if (!p || !fs.existsSync(p)) throw new AppError(404, 'Stored file not found');
  return { stream: fs.createReadStream(p), mimeType: desc.mimeType, filename: desc.filename, path: p };
}

/** remove(descriptor) — best-effort delete (used on cert delete). */
async function remove(desc) {
  try {
    if (!desc) return;
    const provider = desc.provider === 'local' ? 'disk' : desc.provider;
    if (provider === 'memory') { memoryStore.delete(desc.key); return; }
    if (provider === 'gridfs') { await gridfsBucket().delete(new mongoose.mongo.ObjectId(desc.key)); return; }
    if (desc.path && fs.existsSync(desc.path)) fs.unlinkSync(desc.path);
  } catch (err) {
    logger.warn('storage.remove failed (non-fatal)', { error: err.message });
  }
}

module.exports = { saveBuffer, getStream, remove, resolveDriver, _memoryStore: memoryStore };
