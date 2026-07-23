// src/migrations/reset-db.js
// -----------------------------------------------------------------------------
// DANGER — drops the ENTIRE `soroban_compliance` database, then re-seeds:
//   1) the initial super_admin (from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)
//   2) the default Compliance Programs + templates (seed-p5)
// This wipes ALL data: users, companies, sub-admins, certificates, alerts, etc.
// On-chain contract state is NOT touched (it lives on Stellar, not in this DB).
//
// Guarded: you MUST set CONFIRM_RESET=yes or it refuses to run.
//
// Run (PowerShell):
//   cd backend
//   $env:MONGO_URI="<your mongo connection string>"
//   $env:SEED_ADMIN_EMAIL="admin@aitt.io"
//   $env:SEED_ADMIN_PASSWORD="AittAdmin2026!"   # min 12 chars
//   $env:CONFIRM_RESET="yes"
//   node src/migrations/reset-db.js
// -----------------------------------------------------------------------------
require('dotenv').config(); // read MONGO_URI (and friends) from backend/.env
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { seedAdmin } = require('./seed-admin');
const { runSeed } = require('./seed-p5');

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  if (process.env.CONFIRM_RESET !== 'yes') {
    throw new Error('Refusing to wipe the database. Set CONFIRM_RESET=yes to proceed.');
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { dbName: 'soroban_compliance' });
  try {
    await mongoose.connection.dropDatabase();
    logger.info('reset-db: database dropped');
    const admin = await seedAdmin({
      email: process.env.SEED_ADMIN_EMAIL,
      password: process.env.SEED_ADMIN_PASSWORD,
    });
    const seed = await runSeed();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ dropped: true, admin, seed }, null, 2));
  } finally {
    await mongoose.connection.close();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      logger.error('reset-db failed', { error: e.message });
      // eslint-disable-next-line no-console
      console.error(e.message);
      process.exit(1);
    });
}

module.exports = { main };
