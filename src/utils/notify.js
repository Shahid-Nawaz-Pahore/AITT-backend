// src/utils/notify.js
// ---------------------------------------------------------------------------
// Best-effort per-user notifications. Never throws into the caller — a failed
// notification must not roll back the action that triggered it.
// ---------------------------------------------------------------------------
const Notification = require('../models/Notification');
const logger = require('./logger');

async function notify({ userId, type = 'info', title, message = '', entityType = null, entityId = null }) {
  if (!userId || !title) return null;
  try {
    return await Notification.create({ userId, type, title, message, entityType, entityId });
  } catch (err) {
    logger.warn('notify failed', { error: err.message, userId: String(userId) });
    return null;
  }
}

/** Notify many users with the same payload. */
async function notifyMany(userIds = [], payload = {}) {
  const out = [];
  for (const userId of userIds) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await notify({ ...payload, userId }));
  }
  return out.filter(Boolean);
}

module.exports = { notify, notifyMany };
