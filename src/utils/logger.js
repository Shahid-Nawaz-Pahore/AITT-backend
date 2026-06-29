const { createLogger, format, transports } = require('winston');
const chalk = require('chalk');

// Custom dev formatter
const devFormat = format.printf(({ level, message, timestamp, stack, ...meta }) => {
  const colorizer = {
    error: chalk.red,
    warn: chalk.yellow,
    info: chalk.blue,
    debug: chalk.green,
  }[level] || chalk.white;

  return `${chalk.gray(`[${timestamp}]`)} ${colorizer(level.toUpperCase())} → ${message} ${
    Object.keys(meta).length ? chalk.cyan(JSON.stringify(meta)) : ''
  } ${stack ? chalk.dim(stack) : ''}`;
});

const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.splat(),
    process.env.NODE_ENV === 'production' ? format.json() : devFormat // ✅ wrapped correctly
  ),
  transports: [new transports.Console()],
});

// For morgan (HTTP request logging)
logger.stream = {
  write: (message) => logger.info(message.trim()),
};

module.exports = logger;
