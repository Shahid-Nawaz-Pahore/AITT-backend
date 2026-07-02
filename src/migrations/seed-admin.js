// src/migrations/seed-admin.js
// Bootstrap the initial super_admin out-of-band (register is now guarded — audit
// C1). Idempotent: only creates one if no super_admin exists.
//   SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... node src/migrations/seed-admin.js
const mongoose = require('mongoose');
const User = require('../models/User');
const { hashPassword } = require('../utils/crypto');
const logger = require('../utils/logger');

async function seedAdmin({ email, password }) {
  if (!email || !password) throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required');
  if (String(password).length < 12) throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters');
  const existing = await User.findOne({ role: 'super_admin' });
  if (existing) {
    logger.info('seed-admin: a super_admin already exists; skipping');
    return { created: false };
  }
  const passwordHash = await hashPassword(password);
  const user = await User.create({ email: String(email).toLowerCase(), passwordHash, role: 'super_admin' });
  logger.info('seed-admin: super_admin created', { id: user._id, email });
  return { created: true, id: String(user._id) };
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { dbName: 'soroban_compliance' });
  try {
    const out = await seedAdmin({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(out));
  } finally {
    await mongoose.connection.close();
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { logger.error('seed-admin failed', { error: e.message }); process.exit(1); });
}

module.exports = { seedAdmin };
