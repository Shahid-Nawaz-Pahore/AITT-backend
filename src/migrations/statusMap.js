// src/migrations/statusMap.js
// ---------------------------------------------------------------------------
// Migrate legacy Certificate.status (pre-P1 5-value enum) to the new 9-value
// DocStatus using utils/statusMap.LEGACY_STATUS_TO_DOC.
//
//   requested -> submitted
//   validated -> issued        (legacy `validated` came after issuance)
//   issued / revoked / expired -> unchanged (same string in the new enum)
//
// Uses updateMany so it bypasses the (now stricter) document validators that
// would reject the legacy values still on disk. Idempotent: rows already on a
// new value are not matched. Operates on the CURRENT mongoose connection.
// ---------------------------------------------------------------------------
const Certificate = require('../models/Certificate');
const { LEGACY_STATUS_TO_DOC } = require('../utils/statusMap');
const logger = require('../utils/logger');

/**
 * migrateCertificateStatuses({ dryRun }) -> { [legacy]: { matched, modified, to } }
 */
async function migrateCertificateStatuses({ dryRun = false } = {}) {
  const results = {};

  for (const [legacy, next] of Object.entries(LEGACY_STATUS_TO_DOC)) {
    // Skip no-op maps (legacy value identical to its target, e.g. issued->issued).
    if (legacy === next) {
      results[legacy] = { matched: 0, modified: 0, to: next, skipped: 'identity' };
      continue;
    }

    const filter = { status: legacy };
    const matched = await Certificate.countDocuments(filter);

    if (dryRun || matched === 0) {
      results[legacy] = { matched, modified: 0, to: next, dryRun: !!dryRun };
      continue;
    }

    const res = await Certificate.updateMany(filter, { $set: { status: next } });
    results[legacy] = {
      matched,
      modified: res.modifiedCount ?? res.nModified ?? 0,
      to: next,
    };
    logger.info('Migrated certificate statuses', { from: legacy, to: next, modified: results[legacy].modified });
  }

  return results;
}

module.exports = { migrateCertificateStatuses };
