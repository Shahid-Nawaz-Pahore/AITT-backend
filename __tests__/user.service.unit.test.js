// __tests__/user.service.unit.test.js
// Locks the AppError argument order (E re-audit M-NEW): these must be
// (statusCode:number, message:string) so the central error handler can call
// res.status(err.statusCode) without faulting.
jest.mock('../src/models/User', () => ({ findById: jest.fn(), findOne: jest.fn(), findByIdAndUpdate: jest.fn(), findByIdAndDelete: jest.fn() }));
jest.mock('../src/models/Company', () => ({ find: jest.fn() }));
jest.mock('../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const User = require('../src/models/User');
const userService = require('../src/services/user.service');

beforeEach(() => jest.clearAllMocks());

describe('user.service — AppError arg order (M-NEW regression)', () => {
  it('findUserById throws a numeric 404 when the user is missing', async () => {
    User.findById.mockResolvedValueOnce(null);
    await expect(userService.findUserById('x')).rejects.toMatchObject({ statusCode: 404, message: 'User not found' });
  });

  it('createUser throws a numeric 400 on a duplicate email', async () => {
    User.findOne.mockResolvedValueOnce({ _id: 'u1' });
    await expect(userService.createUser({ email: 'A@B.io' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('promoteUserToRegulatorAdmin throws a numeric 404 when missing', async () => {
    User.findById.mockResolvedValueOnce(null);
    await expect(userService.promoteUserToRegulatorAdmin('x')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('demoteRegulatorAdmin throws a numeric 404 when missing', async () => {
    User.findById.mockResolvedValueOnce(null);
    await expect(userService.demoteRegulatorAdmin('x')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('deleteUser throws a numeric 404 when missing', async () => {
    User.findByIdAndDelete.mockResolvedValueOnce(null);
    await expect(userService.deleteUser('x')).rejects.toMatchObject({ statusCode: 404 });
  });
});
