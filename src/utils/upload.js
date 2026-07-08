// src/utils/upload.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const AppError = require('./AppError');

const UPLOAD_BASE_DIR = process.env.UPLOAD_BASE_DIR || '/data';
const CERT_UPLOAD_DIR = process.env.CERT_UPLOAD_DIR || 'certificates';
const DEST_DIR = path.join(UPLOAD_BASE_DIR, CERT_UPLOAD_DIR);

// Multer buffering mode. The uploaded bytes are now persisted by
// services/storage.service (GridFS/disk/memory — H4 #11), so multer only needs
// to hand us the buffer: default to MEMORY unless disk is explicitly selected
// (STORAGE_DRIVER=disk or the legacy USE_DISK_UPLOAD=true). This removes the
// noisy /data mkdir on boot in GridFS mode and is multi-instance-correct.
const IS_DISK_UPLOAD = String(process.env.STORAGE_DRIVER).toLowerCase() === 'disk'
  || String(process.env.USE_DISK_UPLOAD).toLowerCase() === 'true';

// Ensure the directory exists only when disk upload is enabled. On a read-only
// filesystem (e.g. Vercel serverless, where only /tmp is writable) mkdir throws
// at import time — degrade to in-memory storage instead of crashing the whole
// app. `useDisk` is the EFFECTIVE mode after this check and is what the rest of
// the module (and consumers, via the export) rely on.
let useDisk = IS_DISK_UPLOAD;
if (useDisk) {
  try {
    fs.mkdirSync(DEST_DIR, { recursive: true, mode: 0o750 });
  } catch (err) {
    useDisk = false;
    // eslint-disable-next-line no-console
    console.warn(`[upload] cannot create ${DEST_DIR} (${err.message}); falling back to in-memory storage`);
  }
}

// Documents only by default (PDF + Word). Videos, images, archives and apps are
// rejected. Override with ALLOWED_MIMETYPES only if other document types are needed.
const DEFAULT_ALLOWED =
  'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const allowed = (process.env.ALLOWED_MIMETYPES || DEFAULT_ALLOWED)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function secureFilename(originalName) {
  const ext = path.extname(originalName).slice(0, 20) || '';
  const rnd = crypto.randomBytes(8).toString('hex');
  const ts = Date.now();
  return `${ts}-${rnd}${ext}`;
}

let storage;
if (useDisk) {
  storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, DEST_DIR),
    filename: (req, file, cb) => cb(null, secureFilename(file.originalname))
  });
} else {
  // Memory storage - file will be available as req.file.buffer (no disk write)
  storage = multer.memoryStorage();
}

function fileFilter(req, file, cb) {
  if (!allowed.includes(file.mimetype)) {
    return cb(
      new AppError(
        400,
        `Only document files are allowed (PDF or Word). "${file.originalname}" was rejected (type: ${file.mimetype || 'unknown'}).`,
      ),
      false,
    );
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: parseInt(process.env.MAX_UPLOAD_BYTES || '10485760', 10) } // 10MB default
});

module.exports = {
  uploadSingle: (field = 'file') => upload.single(field),
  DEST_DIR,
  CERT_UPLOAD_DIR,
  IS_DISK_UPLOAD: useDisk // effective mode (may have degraded to memory on a read-only FS)
};
