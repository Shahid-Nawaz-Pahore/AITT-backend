const { createLogger, format, transports } = require('winston');
const chalk = require('chalk');

// ---------------------------------------------------------------------------
// Secret redaction (D13 — "no secrets are ever logged"). A structured-meta
// scrubber that replaces the VALUE of any key whose name looks sensitive
// (password / secret / token / api key / private key / mnemonic / authorization)
// with '[REDACTED]', recursively. This protects against accidentally logging a
// custodial secret, JWT, refresh token, or Authorization header via log meta.
// ---------------------------------------------------------------------------
const REDACT_RE = /(pass(word)?|secret|token|mnemonic|private[_-]?key|seed[_-]?phrase|authorization|api[_-]?key|credential)/i;
const RESERVED = new Set(['level', 'message', 'timestamp', 'stack', 'splat', Symbol.for('level'), Symbol.for('message'), Symbol.for('splat')]);

function redactDeep(val, depth = 0) {
  if (depth > 6 || val == null || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map((v) => redactDeep(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(val)) {
    out[k] = REDACT_RE.test(k) ? '[REDACTED]' : redactDeep(v, depth + 1);
  }
  return out;
}

const redactFormat = format((info) => {
  for (const k of Object.keys(info)) {
    if (RESERVED.has(k)) continue;
    info[k] = REDACT_RE.test(k) ? '[REDACTED]' : redactDeep(info[k]);
  }
  return info;
})();

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
    redactFormat, // scrub sensitive meta BEFORE it hits any transport
    process.env.NODE_ENV === 'production' ? format.json() : devFormat
  ),
  transports: [new transports.Console()],
});

// For morgan (HTTP request logging)
logger.stream = {
  write: (message) => logger.info(message.trim()),
};

module.exports = logger;
