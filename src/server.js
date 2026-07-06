// src/server.js — process entrypoint.
// Load env, FAIL-FAST validate it (H2 #4 / C2), then build the app, connect the
// DB, start the scheduler, and listen. Nothing "limps along" on bad config.
require('dotenv').config();

const { validateEnv } = require('./config/env');
const logger = require('./utils/logger');

// Validate BEFORE requiring app/db so a misconfig aborts immediately with the
// full problem list (process.exit(1) on failure).
const cfg = validateEnv({ exitOnError: true, logger });
logger.info('Configuration validated', cfg);

const app = require('./app');
const connectDB = require('./config/db');
const { startScheduler } = require('./services/scheduler');

const PORT = process.env.PORT || 4000;

connectDB()
  .then(() => {
    startScheduler();
    app.listen(PORT, () => {
      logger.info(`Server started on port ${PORT}`);
    });
  })
  .catch((err) => {
    logger.error('Failed to start server', { error: err && err.message });
    process.exit(1);
  });
