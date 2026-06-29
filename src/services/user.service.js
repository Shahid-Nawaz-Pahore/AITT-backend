const User = require('../models/User');
const AppError = require('../utils/AppError');
const Company = require('../models/Company');
const logger = require('../utils/logger');
/**
 * Find user by ID
 */
async function findUserById(id) {
  const user = await User.findById(id);
  if (!user) throw new AppError('User not found', 404);
  return user;
}

/**
 * Find user by email (for login / lookup)
 */
async function findUserByEmail(email) {
  return User.findOne({ email: email.toLowerCase() });
}

/**
 * Create a new user
 */
async function createUser({ name, email, password, role = 'company_admin', companyId = null }) {
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) throw new AppError('Email already registered', 400);

  const user = await User.create({ name, email: email.toLowerCase(), password, role, companyId });
  return user;
}

/**
 * Update user details (safe fields only)
 */
async function updateUser(id, updates) {
  const allowed = ['name', 'password']; // restrict what can be updated directly
  const filtered = Object.keys(updates)
    .filter((key) => allowed.includes(key))
    .reduce((obj, key) => ({ ...obj, [key]: updates[key] }), {});

  const user = await User.findByIdAndUpdate(id, filtered, { new: true });
  if (!user) throw new AppError('User not found', 404);
  return user;
}

async function promoteUserToRegulatorAdmin(id) {
  const user = await User.findById(id); 
  if (!user) throw new AppError('User not found', 404);
  
  user.role = 'regulator_admin';
  // user.regulatorId = regulatorId;
  await user.save();
  return user;
}

async function demoteRegulatorAdmin(id) {
  const user = await User.findById(id); 
  if (!user) throw new AppError('User not found', 404);
  
  user.role = 'company_admin';
  //user.regulatorId = null;
  await user.save();
  return user;
}

/**
 * Delete user
 */
async function deleteUser(id) {
  const user = await User.findByIdAndDelete(id);
  if (!user) throw new AppError('User not found', 404);
  return true;
}

async function getAllUsersGrouped() {
  const projection = 'email role companyId regulatorId walletAddress isActive lastLoginAt createdAt';

  try {
    // fetch both groups in parallel (keep lightweight)
    const [regulatorAdminsRaw, companyAdminsRaw] = await Promise.all([
      User.find({ role: 'regulator_admin' })
        .select(projection)
        .populate({ path: 'regulatorId', select: 'name' }) // keep regulator name for convenience
        .lean(),

      User.find({ role: 'company_admin' })
        .select(projection)
        .lean()
    ]);

    // collect all non-null companyIds across both groups (safe-checking)
    const companyIdSet = new Set();
    const pushId = (id) => {
      if (!id) return;
      // handle both ObjectId and string
      const s = (typeof id === 'object' && id.toString) ? id.toString() : String(id);
      if (s && s !== 'null' && s !== 'undefined') companyIdSet.add(s);
    };

    regulatorAdminsRaw.forEach(u => pushId(u.companyId));
    companyAdminsRaw.forEach(u => pushId(u.companyId));

    const companyIds = Array.from(companyIdSet);

    // fetch company details only if we have any ids
    let companiesById = {};
    if (companyIds.length > 0) {
      const companies = await Company.find({ _id: { $in: companyIds } })
        .select('name contactEmail contactPhone walletAddress metadata createdAt updatedAt')
        .lean();

      companiesById = companies.reduce((acc, c) => {
        acc[c._id.toString()] = c;
        return acc;
      }, {});
    }

    // helper to map a user and attach companyData + isRegulator
    const mapUser = (user) => {
      // safe company lookup
      let companyData = null;
      if (user.companyId) {
        const key = (typeof user.companyId === 'object' && user.companyId.toString) ? user.companyId.toString() : String(user.companyId);
        companyData = companiesById[key] || null;
      }

      const isRegulator = (user.role === 'regulator_admin') || (!!user.regulatorId);

      return {
        ...user,
        companyData,
        isRegulator
      };
    };

    const regulatorAdmins = regulatorAdminsRaw.map(mapUser);
    const companyAdmins = companyAdminsRaw.map(mapUser);

    logger.info('Fetched grouped users', {
      regulatorAdminsCount: regulatorAdmins.length,
      companyAdminsCount: companyAdmins.length,
      companiesFetched: companyIds.length
    });

    return { regulatorAdmins, companyAdmins };
  } catch (err) {
    logger.error('getAllUsersGrouped failed', { err: err.message });
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'Failed to fetch users', err.message);
  }
}

module.exports = {
  findUserById,
  findUserByEmail,
  createUser,
  updateUser,
  deleteUser,
  promoteUserToRegulatorAdmin,
  demoteRegulatorAdmin,
  getAllUsersGrouped
};
