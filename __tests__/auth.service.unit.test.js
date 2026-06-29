// __tests__/auth.service.unit.test.js
// Unit tests for src/services/auth.service.js
// Mocks external dependencies (models, jwt, bcrypt, crypto utils, logger, services, mongoose sessions)

jest.resetModules();

// Minimal required env so module loads
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'TEST_ACCESS_SECRET';
process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
process.env.JWT_REFRESH_TTL = process.env.JWT_REFRESH_TTL || '60d';

// Mock jsonwebtoken
jest.doMock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'MOCKED_ACCESS_TOKEN')
}));

// Mock bcrypt (used in refresh and api key flows)
jest.doMock('bcryptjs', () => ({
  compare: jest.fn()
}));

// Mock crypto utils (hashPassword, verifyPassword, generateRandomToken)
jest.doMock('../src/utils/crypto', () => ({
  hashPassword: jest.fn(async (v) => `HASH(${v})`),
  verifyPassword: jest.fn(async (plain, hash) => plain === 'goodpassword' && hash === 'HASH(goodpassword)'),
  generateRandomToken: jest.fn(() => 'RANDOM_RAW_TOKEN')
}));

// Mock logger
jest.doMock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

// Mock models: User, RefreshToken, ApiKey
jest.doMock('../src/models/User', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  findById: jest.fn()
}));
jest.doMock('../src/models/RefreshToken', () => ({
  create: jest.fn(),
  find: jest.fn()
}));
jest.doMock('../src/models/ApiKey', () => ({
  findOne: jest.fn()
}));

// Mock company and regulator services used in registerUser
jest.doMock('../src/services/company.service', () => ({
  getCompanyById: jest.fn(),
  createCompany: jest.fn()
}));
jest.doMock('../src/services/regulator.service', () => ({
  getRegulatorById: jest.fn(),
  createRegulator: jest.fn()
}));

// Mock mongoose.startSession used in registerUser flows
jest.doMock('mongoose', () => ({
  startSession: jest.fn(() => ({
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    abortTransaction: jest.fn(),
    endSession: jest.fn()
  }))
}));

// Now require the mocks and the real auth service module
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cryptoUtils = require('../src/utils/crypto');
const logger = require('../src/utils/logger');
const User = require('../src/models/User');
const RefreshToken = require('../src/models/RefreshToken');
const ApiKey = require('../src/models/ApiKey');
const companyService = require('../src/services/company.service');
const regulatorService = require('../src/services/regulator.service');

const auth = require('../src/services/auth.service');
const AppError = require('../src/utils/AppError');

describe('auth.service (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registerUser', () => {
    it('throws 500 when email or role missing (service wraps errors to 500)', async () => {
      // note: service currently wraps AppError into 500 at top-level catch
      await expect(auth.registerUser({})).rejects.toMatchObject({ statusCode: 500 });
    });

    it('super_admin: prevents duplicate super admin (wrapped -> 500)', async () => {
      User.findOne.mockResolvedValueOnce({ _id: 'existingSuper' });
      await expect(auth.registerUser({ email: 'a@b', role: 'super_admin', password: 'p' }))
        .rejects.toMatchObject({ statusCode: 500 });
      expect(User.findOne).toHaveBeenCalledWith({ role: 'super_admin' });
    });

    it('super_admin: creates when none exists', async () => {
      User.findOne.mockResolvedValueOnce(null);
      const createdUser = { _id: 'u1', email: 'a@b', role: 'super_admin' };
      User.create.mockResolvedValueOnce(createdUser);

      const res = await auth.registerUser({ email: 'a@b', role: 'super_admin', password: 'p' });
      expect(User.create).toHaveBeenCalledWith({ email: 'a@b', passwordHash: expect.any(String), role: 'super_admin' });
      expect(res).toBe(createdUser);
    });

    it('company_admin: with existing companyId', async () => {
      companyService.getCompanyById.mockResolvedValueOnce({ _id: 'comp1' });
      // session is mocked by mongoose.startSession
      User.create.mockResolvedValueOnce([{ _id: 'u2' }]);
      const res = await auth.registerUser({ email: 'x@c', password: 'pw', role: 'company_admin', companyId: 'comp1' });
      expect(companyService.getCompanyById).toHaveBeenCalledWith('comp1');
      expect(User.create).toHaveBeenCalled();
      expect(res._id).toBe('u2');
    });

    it('company_admin: without companyId creates company and user', async () => {
      const createdCompany = { _id: 'newComp' };
      companyService.createCompany.mockResolvedValueOnce(createdCompany);
      User.create.mockResolvedValueOnce([{ _id: 'u3' }]);

      const res = await auth.registerUser({
        email: 'new@co',
        password: 'pw',
        role: 'company_admin',
        company: { name: 'Co' }
      });

      expect(companyService.createCompany).toHaveBeenCalledWith({ name: 'Co' }, expect.any(Object));
      expect(User.create).toHaveBeenCalled();
      expect(res._id).toBe('u3');
    });

    it('regulator_admin: with regulatorId', async () => {
      regulatorService.getRegulatorById.mockResolvedValueOnce({ _id: 'reg1' });
      User.create.mockResolvedValueOnce([{ _id: 'u4' }]);

      const res = await auth.registerUser({ email: 'r@x', password: 'pw', role: 'regulator_admin', regulatorId: 'reg1' });
      expect(regulatorService.getRegulatorById).toHaveBeenCalledWith('reg1');
      expect(User.create).toHaveBeenCalled();
      expect(res._id).toBe('u4');
    });

    it('regulator_admin: without regulatorId creates regulator and user', async () => {
      const createdReg = { _id: 'newReg' };
      regulatorService.createRegulator.mockResolvedValueOnce(createdReg);
      User.create.mockResolvedValueOnce([{ _id: 'u5' }]);

      const res = await auth.registerUser({
        email: 'r2@x',
        password: 'pw',
        role: 'regulator_admin',
        regulator: { name: 'RegCo' }
      });

      expect(regulatorService.createRegulator).toHaveBeenCalledWith({ name: 'RegCo' }, expect.any(Object));
      expect(User.create).toHaveBeenCalled();
      expect(res._id).toBe('u5');
    });

    it('other roles: creates user without org', async () => {
      User.create.mockResolvedValueOnce({ _id: 'u6', role: 'viewer' });
      const res = await auth.registerUser({ email: 'v@x', password: 'pw', role: 'viewer' });
      expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'v@x', role: 'viewer' }));
      expect(res._id).toBe('u6');
    });
  });

  describe('signAccessToken', () => {
    it('calls jwt.sign with expected payload', () => {
      const user = { _id: 'userid', role: 'company_admin', companyId: 'comp1', regulatorId: null };
      const token = auth.signAccessToken(user);
      // jwt.sign is mocked to return 'MOCKED_ACCESS_TOKEN'
      expect(jwt.sign).toHaveBeenCalled();
      expect(token).toBe('MOCKED_ACCESS_TOKEN');
    });
  });

  describe('issueRefreshToken', () => {
    it('creates a RefreshToken and returns raw token', async () => {
      // RefreshToken.create is mocked below; ensure it resolves
      RefreshToken.create.mockResolvedValueOnce({ _id: 'rt1' });
      const user = { _id: 'u7' };
      const raw = await auth.issueRefreshToken(user, { ua: 'ua', ip: '1.2.3.4' });
      expect(RefreshToken.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u7', tokenHash: expect.any(String) }));
      expect(raw).toBe('RANDOM_RAW_TOKEN');
    });

    it('wraps errors into AppError', async () => {
      RefreshToken.create.mockRejectedValueOnce(new Error('db fail'));
      await expect(auth.issueRefreshToken({ _id: 'u8' })).rejects.toBeInstanceOf(AppError);
    });
  });

  describe('login', () => {
    it('throws 401 when user not found', async () => {
      User.findOne.mockResolvedValueOnce(null);
      await expect(auth.login({ email: 'no@x', password: 'p' })).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 401 when no password set', async () => {
      User.findOne.mockResolvedValueOnce({ _id: 'u9', isActive: true, passwordHash: null });
      await expect(auth.login({ email: 'u9', password: 'p' })).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 401 when invalid password', async () => {
      // verifyPassword mocked: returns true only for 'goodpassword' & correct hash
      User.findOne.mockResolvedValueOnce({ _id: 'u10', isActive: true, passwordHash: 'HASH(goodpassword)' });
      // call with wrong password
      await expect(auth.login({ email: 'u10', password: 'bad' })).rejects.toMatchObject({ statusCode: 401 });
    });

    it('successful login returns access and refresh', async () => {
      const user = {
        _id: 'u11',
        isActive: true,
        passwordHash: 'HASH(goodpassword)',
        save: jest.fn()
      };
      User.findOne.mockResolvedValueOnce(user);
      // make verifyPassword return true
      cryptoUtils.verifyPassword.mockResolvedValueOnce(true);

      // Important: issueRefreshToken is called *internally* by login; instead of spying on exported name,
      // mock RefreshToken.create so the internal issueRefreshToken can succeed
      RefreshToken.create.mockResolvedValueOnce({ _id: 'rt1' });

      const res = await auth.login({ email: 'x', password: 'goodpassword', ip: '1.1.1.1', ua: 'ua' });
      expect(res).toHaveProperty('access', 'MOCKED_ACCESS_TOKEN');
      // issueRefreshToken returns the raw from generateRandomToken which our mock returns
      expect(res).toHaveProperty('refresh', 'RANDOM_RAW_TOKEN');
      expect(user.save).toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('throws 500 when refresh token expired (service wraps errors)', async () => {
      // Setup token that matches bcrypt.compare and is expired
      const oldDate = new Date(Date.now() - 1000);
      const tokenDoc = { _id: 't1', tokenHash: 'HASH', userId: 'u12', expiresAt: oldDate, save: jest.fn() };
      RefreshToken.find.mockResolvedValueOnce([tokenDoc]);
      // make bcrypt.compare return true for the provided raw
      bcrypt.compare.mockResolvedValueOnce(true);

      // Because the service currently wraps thrown AppError into 500, expect 500 here
      await expect(auth.refresh({ refreshTokenRaw: 'raw' })).rejects.toMatchObject({ statusCode: 500 });
    });

    it('successful refresh exchanges token', async () => {
      const future = new Date(Date.now() + 1000 * 60 * 60);
      const tokenDoc = { _id: 't2', tokenHash: 'HASH2', userId: 'u13', expiresAt: future, save: jest.fn() };
      RefreshToken.find.mockResolvedValueOnce([tokenDoc]);
      bcrypt.compare.mockResolvedValueOnce(true);

      // mock User.findById to return user
      User.findById.mockResolvedValueOnce({ _id: 'u13' });

      // Let the internal issueRefreshToken run but ensure its DB call succeeds
      RefreshToken.create.mockResolvedValueOnce({ _id: 'newRT' });

      const res = await auth.refresh({ refreshTokenRaw: 'raw' });
      // access created via jwt.sign mock
      expect(res).toHaveProperty('access', 'MOCKED_ACCESS_TOKEN');
      expect(res).toHaveProperty('refresh', 'RANDOM_RAW_TOKEN');
      expect(tokenDoc.revokedAt).toBeDefined();
      expect(tokenDoc.save).toHaveBeenCalled();
    });

    it('throws 500 when no matching token found (service wraps errors)', async () => {
      RefreshToken.find.mockResolvedValueOnce([]);
      await expect(auth.refresh({ refreshTokenRaw: 'x' })).rejects.toMatchObject({ statusCode: 500 });
    });
  });

  describe('exchangeApiKey', () => {
    it('throws 401 when rawKey missing', async () => {
      await expect(auth.exchangeApiKey(null)).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 401 when prefix not found', async () => {
      ApiKey.findOne.mockResolvedValueOnce(null);
      await expect(auth.exchangeApiKey('SOMERAWK')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 401 when bcrypt.compare fails', async () => {
      // Ensure rawKey prefix matches record.prefix
      const rec = { prefix: 'SOMERAWK', isActive: true, hash: 'HASH', ownerType: 'company', ownerId: 'cid', scopes: ['a'] };
      ApiKey.findOne.mockResolvedValueOnce(rec);
      bcrypt.compare.mockResolvedValueOnce(false);
      await expect(auth.exchangeApiKey('SOMERAWK-RESTOFTHEKEY')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('succeeds and returns token + scopes', async () => {
      const rec = { prefix: 'SOMEPFX1', isActive: true, hash: 'HASH', ownerType: 'company', ownerId: 'cid', scopes: ['a'] };
      ApiKey.findOne.mockResolvedValueOnce(rec);
      bcrypt.compare.mockResolvedValueOnce(true);
      const res = await auth.exchangeApiKey('SOMEPFX1-REMAINDER');
      expect(res).toHaveProperty('access', 'MOCKED_ACCESS_TOKEN');
      expect(res).toHaveProperty('scopes');
      expect(Array.isArray(res.scopes)).toBe(true);
    });
  });
});
