const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * Optional authentication middleware.
 * If token exists and is valid, sets req.user. Otherwise, continues silently.
 */
function authenticateOptional(req, res, next) {
  const auth = req.header('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    logger.debug('No JWT token provided (optional auth)');
    return next();
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = { ...payload, sub: payload.sub };
    logger.debug('Optional auth: JWT verified', { userId: payload.sub, role: payload.role });
  } catch (err) {
    logger.warn('Optional auth: invalid JWT, ignoring', { error: err.message });
  }

  return next();
}

/**
 * Required authentication middleware.
 * roles: array of allowed roles, empty = any authenticated user
 */
function requireAuth(roles = []) {
  return (req, res, next) => {
    const auth = req.header('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

    if (!token) {
      logger.warn('Access denied: missing token');
      return res.status(401).json({ success: false, message: 'Missing token' });
    }

    try {
      const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      req.user = { ...payload, sub: payload.sub };
      logger.info('JWT verified', { userId: payload.sub, role: payload.role });

      if (roles.length && !roles.includes(req.user.role)) {
        logger.warn('Access denied: user role not permitted', { userId: payload.sub, role: payload.role, allowedRoles: roles });
        return res.status(403).json({ success: false, message: 'Forbidden: insufficient role' });
      }

      return next();
    } catch (err) {
      logger.error('Invalid or expired JWT', { error: err.message });
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
  };
}

module.exports = { requireAuth, authenticateOptional };
