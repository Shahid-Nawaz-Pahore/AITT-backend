const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const ApiKey = require('../models/ApiKey');
const { hashPassword, verifyPassword, generateRandomToken } = require('../utils/crypto');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_TTL_MS = (() => {
  const ttl = process.env.JWT_REFRESH_TTL || '60d';
  if (ttl.endsWith('d')) return parseInt(ttl) * 24 * 60 * 60 * 1000;
  if (ttl.endsWith('h')) return parseInt(ttl) * 60 * 60 * 1000;
  return 60 * 24 * 60 * 60 * 1000;
})();

if (!ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET must be set in .env');

/**
 * Register a new user
 */
const mongoose = require('mongoose');
const companyService = require('./company.service');
const regulatorService = require('./regulator.service');

async function registerUser({ email, password, role, companyId = null, company = null, regulatorId = null, regulator = null }) {
  const session = await mongoose.startSession();

  try {
    const passwordHash = password ? await hashPassword(password) : null;

    if (!email || !role) {
      throw new AppError(400, 'email and role are required');
    }
    // === Super Admin Bootstrapping ===
    if (role === 'super_admin') {
      // ⚠️ TEMPORARY: Allow direct super_admin creation for bootstrapping
      const existingSuper = await User.findOne({ role: 'super_admin' });
      if (existingSuper) {
        logger.warn('Super admin already exists; additional creation is discouraged', { email });
        throw new AppError(400, 'Only one super_admin allowed ');

      }
      const user = await User.create({ email, passwordHash, role: 'super_admin' });
      logger.info('Super admin registered (bootstrap)', { userId: user._id, email });
      return user;
    }
    // === Company Admin Flow ===
    if (role === 'company_admin') {
      await session.startTransaction();
      try {
        let companyToUseId = companyId;

        if (companyId) {
          const comp = await companyService.getCompanyById(companyId);
          if (!comp) throw new AppError(404, 'Provided companyId not found');
        } else {
          if (!company || !company.name) {
            throw new AppError(400, 'company data (name) required when companyId not provided');
          }
          const createdCompany = await companyService.createCompany(company, { session });
          companyToUseId = createdCompany._id;
        }

        const user = await User.create([{ email, passwordHash, role, companyId: companyToUseId }], { session });
        await session.commitTransaction();
        logger.info('Company admin registered', { userId: user[0]._id, companyId: companyToUseId });
        return user[0];
      } catch (err) {
        await session.abortTransaction();
        throw err;
      } finally {
        session.endSession();
      }
    }

    // === Regulator Admin Flow ===
    if (role === 'regulator_admin') {
      await session.startTransaction();
      try {
        let regulatorToUseId = regulatorId;

        if (regulatorId) {
          const reg = await regulatorService.getRegulatorById(regulatorId);
          if (!reg) throw new AppError(404, 'Provided regulatorId not found');
        } else {
          if (!regulator || !regulator.name) {
            throw new AppError(400, 'regulator data (name) required when regulatorId not provided');
          }
          const createdReg = await regulatorService.createRegulator(regulator, { session });
          regulatorToUseId = createdReg._id;
        }

        const user = await User.create([{ email, passwordHash, role, regulatorId: regulatorToUseId }], { session });
        await session.commitTransaction();
        logger.info('Regulator admin registered', { userId: user[0]._id, regulatorId: regulatorToUseId });
        return user[0];
      } catch (err) {
        await session.abortTransaction();
        throw err;
      } finally {
        session.endSession();
      }
    }

    // === Other Roles (super_admin, viewer, etc.) ===
    const user = await User.create({ email, passwordHash, role });
    logger.info('User registered (no org)', { userId: user._id, role: user.role });
    return user;

  } catch (err) {
    logger.error('User registration failed', { email, error: err.message });
    throw new AppError(500, 'Failed to register user', err.message);
  }
}



/**
 * Sign an access token
 */
function signAccessToken(user) {
  const payload = {
    sub: user._id.toString(),
    role: user.role,
    companyId: user.companyId || null,
    regulatorId: user.regulatorId || null,
  };
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

/**
 * Issue a refresh token
 */
async function issueRefreshToken(user, ctx = {}) {
  try {
    const raw = generateRandomToken(48);
    const tokenHash = await hashPassword(raw);

    const doc = await RefreshToken.create({
      userId: user._id,
      tokenHash,
      userAgent: ctx.ua,
      ip: ctx.ip,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    });

    logger.debug('Refresh token issued', { userId: user._id, refreshId: doc._id });
    return raw;
  } catch (err) {
    logger.error('Failed to issue refresh token', { userId: user._id, err: err.message });
    throw new AppError(500, 'Failed to issue refresh token', err.message);
  }
}

/**
 * User login
 */
async function login({ email, password, ip, ua }) {
  try {
    const user = await User.findOne({ email, isActive: true });
    if (!user) throw new AppError(401, 'Invalid credentials');
    if (!user.passwordHash) throw new AppError(401, 'No password set for this user');

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw new AppError(401, 'Invalid credentials');

    user.lastLoginAt = new Date();
    await user.save();

    const access = signAccessToken(user);
    const refresh = await issueRefreshToken(user, { ip, ua });

    logger.info('User logged in', { userId: user._id, email, ip });
    return { access, refresh, role: user.role };
  } catch (err) {
    logger.error('Login failed', { email, err: err.message });
    throw err instanceof AppError ? err : new AppError(500, 'Login failed', err.message);
  }
}

/**
 * Refresh token flow
 */
async function refresh({ refreshTokenRaw }) {
  try {
    const tokens = await RefreshToken.find({ revokedAt: null }).sort({ createdAt: -1 }).limit(100);

    for (const t of tokens) {
      const match = await bcrypt.compare(refreshTokenRaw, t.tokenHash);
      if (match) {
        if (t.expiresAt && t.expiresAt < new Date()) {
          throw new AppError(401, 'Refresh token expired');
        }

        t.revokedAt = new Date();
        await t.save();

        const user = await User.findById(t.userId);
        if (!user) throw new AppError(404, 'User not found for refresh token');

        const access = signAccessToken(user);
        const newRefresh = await issueRefreshToken(user);

        logger.info('Refresh token exchanged', { userId: user._id, refreshId: t._id });
        return { access, refresh: newRefresh };
      }
    }

    throw new AppError(401, 'Invalid refresh token');
  } catch (err) {
    logger.error('Refresh token failed', { err: err.message });
    throw err instanceof AppError ? err : new AppError(500, 'Refresh token failed', err.message);
  }
}

/**
 * Exchange API key for access token
 */
async function exchangeApiKey(rawKey) {
  try {
    if (!rawKey) throw new AppError(401, 'Missing API key');

    const prefix = rawKey.slice(0, 8);
    const record = await ApiKey.findOne({ prefix, isActive: true });
    if (!record) throw new AppError(401, 'Invalid API key');

    const ok = await bcrypt.compare(rawKey, record.hash);
    if (!ok) throw new AppError(401, 'Invalid API key');

    const user = {
      _id: `${record.ownerType}:${record.ownerId}`,
      role: record.ownerType === 'company' ? 'company_admin' : 'regulator_admin',
      companyId: record.ownerType === 'company' ? record.ownerId : null,
      regulatorId: record.ownerType === 'regulator' ? record.ownerId : null,
    };

    const access = jwt.sign(
      { sub: user._id, role: user.role, companyId: user.companyId, regulatorId: user.regulatorId },
      ACCESS_SECRET,
      { expiresIn: ACCESS_TTL }
    );

    logger.info('API key exchanged for token', { ownerType: record.ownerType, ownerId: record.ownerId });
    return { access, scopes: record.scopes || [] };
  } catch (err) {
    logger.error('API key exchange failed', { err: err.message });
    throw err instanceof AppError ? err : new AppError(500, 'API key exchange failed', err.message);
  }
}

module.exports = {
  registerUser,
  login,
  refresh,
  signAccessToken,
  issueRefreshToken,
  exchangeApiKey,
};
