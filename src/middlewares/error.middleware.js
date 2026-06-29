const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

function errorHandler(err, req, res, next) {
  if (!(err instanceof AppError)) {
    logger.error('Unexpected error', { err });
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }

  logger.warn(`Handled error: ${err.message}`, { statusCode: err.statusCode, details: err.details });
  res.status(err.statusCode).json({
    success: false,
    message: err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}

function notFound(req, res, next) {
  res.status(404).json({
    success: false,
    message: `Not Found - ${req.originalUrl}`,
  });
}

module.exports = { notFound, errorHandler };
