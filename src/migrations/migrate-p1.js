// src/migrations/migrate-p1.js
// ---------------------------------------------------------------------------
// P1 data migration runner. Idempotent. Run with:
//     node src/migrations/migrate-p1.js            (apply)
//     node src/migrations/migrate-p1.js --dry-run  (report only)
//     node src/migrations/migrate-p1.js --no-roles (skip role conversion)
//
// Applies the P1 defaulted decisions to existing data:
//   1. Company.status backfill: existing companies (no status) -> 'active'
//      (M2: NEW companies default 'pending'; pre-existing are already approved).
//   2. User.role conversion: legacy 'regulator_admin' -> 'sub_admin'
//      (A3: the alias keeps working, but this normalizes stored records).
//   3. Certificate.status: legacy 5-value -> new 9-value DocStatus
//      (delegates to migrations/statusMap.js).
//
// Each step uses updateMany (bypasses the stricter post-P1 validators) and only
// matches rows still holding legacy/missing values, so re-running is safe.
// ---------------------------------------------------------------------------
const mongoose = require('mongoose');

const Company = require('../models/Company');
const User = require('../models/User');
const { migrateCertificateStatuses } = require('./statusMap');
const logger = require('../utils/logger');

async function backfillCompanyStatus({ dryRun = false } = {}) {
  const filter = { $or: [{ status: { $exists: false } }, { status: null }] };
  const matched = await Company.countDocuments(filter);
  if (dryRun || matched === 0) return { matched, modified: 0, to: 'active', dryRun: !!dryRun };
  const res = await Company.updateMany(filter, { $set: { status: 'active' } });
  const modified = res.modifiedCount ?? res.nModified ?? 0;
  logger.info('Backfilled company status', { to: 'active', modified });
  return { matched, modified, to: 'active' };
}

async function convertRegulatorRole({ dryRun = false } = {}) {
  const filter = { role: 'regulator_admin' };
  const matched = await User.countDocuments(filter);
  if (dryRun || matched === 0) return { matched, modified: 0, to: 'sub_admin', dryRun: !!dryRun };
  const res = await User.updateMany(filter, { $set: { role: 'sub_admin' } });
  const modified = res.modifiedCount ?? res.nModified ?? 0;
  logger.info('Converted regulator_admin -> sub_admin', { modified });
  return { matched, modified, to: 'sub_admin' };
}

/**
 * runP1Migration({ dryRun, convertRoles }) — runs all steps on the CURRENT
 * mongoose connection and returns a per-step report. Does NOT open/close the
 * connection (so it is reusable from tests).
 */
async function runP1Migration({ dryRun = false, convertRoles = true } = {}) {
  const report = {
    companyStatus: await backfillCompanyStatus({ dryRun }),
    certificateStatus: await migrateCertificateStatuses({ dryRun }),
    roleConversion: convertRoles
      ? await convertRegulatorRole({ dryRun })
      : { skipped: 'convertRoles=false' },
  };
  return report;
}

// CLI entrypoint — opens/closes its own connection.
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const convertRoles = !args.includes('--no-roles');

  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { dbName: 'soroban_compliance' });
  logger.info('migrate-p1: connected', { dryRun, convertRoles });

  try {
    const report = await runP1Migration({ dryRun, convertRoles });
    logger.info('migrate-p1: complete', { report });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ dryRun, convertRoles, report }, null, 2));
  } finally {
    await mongoose.connection.close();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('migrate-p1 failed', { error: err.message, stack: err.stack });
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}

module.exports = {
  runP1Migration,
  backfillCompanyStatus,
  convertRegulatorRole,
};
