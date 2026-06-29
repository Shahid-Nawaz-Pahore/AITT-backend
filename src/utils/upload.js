// src/utils/upload.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_BASE_DIR = process.env.UPLOAD_BASE_DIR || '/data';
const CERT_UPLOAD_DIR = process.env.CERT_UPLOAD_DIR || 'certificates';
const DEST_DIR = path.join(UPLOAD_BASE_DIR, CERT_UPLOAD_DIR);

// Toggle: control whether files are written to disk or kept in memory.
// Default: true (keeps original behavior). Set to 'false' in .env to use memory storage.
const IS_DISK_UPLOAD = (typeof process.env.USE_DISK_UPLOAD === 'undefined')
  ? true
  : (String(process.env.USE_DISK_UPLOAD).toLowerCase() === 'true');

// ensure directory exists only when disk upload is enabled
if (IS_DISK_UPLOAD) {
  try {
    fs.mkdirSync(DEST_DIR, { recursive: true, mode: 0o750 });
  } catch (err) {
    // If mkdir fails, throw so app won't run in an inconsistent state
    // (logging isn't available here - but throwing is appropriate)
    throw new Error(`Failed to create upload directory ${DEST_DIR}: ${err.message}`);
  }
}

// allowed mimetypes
const allowed = (process.env.ALLOWED_MIMETYPES || 'application/pdf,image/png,image/jpeg')
  .split(',');

function secureFilename(originalName) {
  const ext = path.extname(originalName).slice(0, 20) || '';
  const rnd = crypto.randomBytes(8).toString('hex');
  const ts = Date.now();
  return `${ts}-${rnd}${ext}`;
}

let storage;
if (IS_DISK_UPLOAD) {
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
    return cb(new Error('Invalid file type'), false);
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
  IS_DISK_UPLOAD
};
