require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const cors = require('cors');
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
app.use(morgan('combined', { stream: logger.stream }));
app.set('trust proxy', 1);

// basic rate limiter
app.use(
  rateLimit({ windowMs: 15 * 60 * 1000, max: 200 })
);

// --- uploads config & ensure directories exist ---
const UPLOAD_BASE_DIR = process.env.UPLOAD_BASE_DIR || '/var/www/app2/uploads';
const CERT_UPLOAD_DIR = process.env.CERT_UPLOAD_DIR || 'certificates';
const CERT_DIR = path.join(UPLOAD_BASE_DIR, CERT_UPLOAD_DIR);

// create dirs on startup (safe even if already exist)
try {
  fs.mkdirSync(CERT_DIR, { recursive: true, mode: 0o750 });
  logger.info(`Ensured upload directory exists: ${CERT_DIR}`);
} catch (e) {
  logger.error('Failed to ensure upload directory', { error: e && e.message });
  // allow process to continue — multer will error if path is not writable
}

// serve uploaded files at /certificates/<filename>
app.use('/certificates', express.static(CERT_DIR, {
  dotfiles: 'ignore',
  index: false,
  // optional: set caching headers by wrapping response if needed
}));

// health
app.get('/', (req, res) => res.send('Soroban Compliance Backend API running'));

// API routes
app.use('/api/v1', routes);

// error handlers
app.use(notFound);
app.use(errorHandler);

module.exports = app;
