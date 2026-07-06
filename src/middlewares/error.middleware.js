const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

// Central error handler. Client-facing responses NEVER leak stack traces or
// internal detail (E-audit / info-leakage):
//   - Non-AppError (unexpected)  → 500 with a generic message; full error logged.
//   - AppError 5xx (server-side) → the (curated) message only; `details` (which
//     may carry raw chain/DB internals) is logged but NOT returned to the client.
//   - AppError 4xx (client-side) → message + details (these are user-facing
//     validation messages, safe to return).
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (!(err instanceof AppError)) {
    logger.error('Unexpected error', { message: err && err.message, stack: err && err.stack });
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }

  const isServer = err.statusCode >= 500;
  logger.warn(`Handled error: ${err.message}`, { statusCode: err.statusCode, details: err.details });

  const body = { success: false, message: err.message };
  // Only surface details for client (4xx) errors — never leak 5xx internals.
  if (!isServer && err.details) body.details = err.details;
  return res.status(err.statusCode).json(body);
}

function notFound(req, res, next) {
  res.status(404).json({
    success: false,
    message: `Not Found - ${req.originalUrl}`,
  });
}

module.exports = { notFound, errorHandler };
