const authService = require('../services/auth.service');
const logger = require('../utils/logger');

async function register(req, res, next) {
  try {
    const { email, password, role, companyId, company, regulatorId, regulator } = req.body;

    const user = await authService.registerUser({ 
      email, password, role, companyId, company, regulatorId, regulator 
    });

    return res.status(201).json({
      success: true,
      data: { userId: user._id, role: user.role, companyId: user.companyId || null, regulatorId: user.regulatorId || null }
    });

  } catch (err) {
    logger.error('Register failed', { error: err.message, stack: err.stack });
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const ip = req.ip;
    const ua = req.get('User-Agent') || '';

    logger.info('Login attempt', { email, ip, ua });

    const tokens = await authService.login({ email, password, ip, ua });

    logger.info('Login successful', { email });
    res.json({ success: true, data: tokens });
  } catch (err) {
    logger.warn('Login failed', { email: req.body.email, error: err.message });
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;

    logger.info('Refresh token attempt');

    const result = await authService.refresh({ refreshTokenRaw: refreshToken });

    logger.info('Refresh token successful');
    res.json({ success: true, data: result });
  } catch (err) {
    logger.warn('Refresh token failed', { error: err.message });
    next(err);
  }
}

async function exchangeApiKey(req, res, next) {
  try {
    const rawKey = req.header('X-API-Key');

    logger.info('API key exchange attempt');

    const result = await authService.exchangeApiKey(rawKey);

    logger.info('API key exchange successful', { scopes: result.scopes });
    res.json({ success: true, data: result });
  } catch (err) {
    logger.warn('API key exchange failed', { error: err.message });
    next(err);
  }
}

module.exports = { register, login, refresh, exchangeApiKey };
