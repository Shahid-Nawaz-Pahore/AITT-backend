require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middlewares/error.middleware');
const logger = require('./utils/logger');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(helmet());
// Configure CORS to only allow requests from our frontend domain
app.use(cors({
  origin: ['https://aitt-transparency.com','http://localhost:5173','http://localhost:4173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'Origin', 'X-Requested-With']
}));
app.use(express.json({ limit: '5mb' }));
// SECURITY (audit #8): strip MongoDB operator keys ($, .) from body/query/params
// so a payload like {"email":{"$ne":null}} can't inject query operators.
app.use(mongoSanitize());
app.use(morgan('combined', { stream: logger.stream }));
app.set('trust proxy', 1);

// basic rate limiter
app.use(
  rateLimit({ windowMs: 15 * 60 * 1000, max: 200 })
);

// --- uploads config & ensure directories exist ---
// Only pre-create the disk upload dir when disk storage is actually selected
// (STORAGE_DRIVER=disk or legacy USE_DISK_UPLOAD=true). On a read-only FS or in
// GridFS/memory mode this is skipped so boot never noisily fails (H4 #11).
const UPLOAD_BASE_DIR = process.env.UPLOAD_BASE_DIR || '/var/www/app2/uploads';
const CERT_UPLOAD_DIR = process.env.CERT_UPLOAD_DIR || 'certificates';
const CERT_DIR = path.join(UPLOAD_BASE_DIR, CERT_UPLOAD_DIR);
const diskSelected = String(process.env.STORAGE_DRIVER).toLowerCase() === 'disk'
  || String(process.env.USE_DISK_UPLOAD).toLowerCase() === 'true';

if (diskSelected) {
  try {
    fs.mkdirSync(CERT_DIR, { recursive: true, mode: 0o750 });
    logger.info(`Ensured upload directory exists: ${CERT_DIR}`);
  } catch (e) {
    logger.warn('Could not pre-create upload directory (storage may fall back)', { error: e && e.message });
  }
}

// SECURITY (audit #1): the public `express.static('/certificates', CERT_DIR)`
// mount was REMOVED — it exposed every uploaded compliance document with no
// auth. Files are now served ONLY through the authenticated, role-scoped
// endpoint GET /api/v1/documents/:id/file (document.controller.downloadDocumentFile).

// --- Liveness / readiness (D10) ---
const health = require('./services/health.service');
// Liveness: process is up. No dependency checks — used by the orchestrator to
// know whether to RESTART the container.
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), ts: new Date().toISOString() }));
// Readiness: dependencies are reachable. Used by the LB to know whether to send
// traffic. Returns 503 when Mongo or (in real mode) the RPC is down.
app.get('/ready', async (req, res) => {
  try {
    const r = await health.readiness();
    res.status(r.ready ? 200 : 503).json(r);
  } catch (err) {
    res.status(503).json({ ready: false, error: err.message });
  }
});

// root
app.get('/', (req, res) => res.send('Soroban Compliance Backend API running'));

// API routes
app.use('/api/v1', routes);

// error handlers
app.use(notFound);
app.use(errorHandler);

module.exports = app;
