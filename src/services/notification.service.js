// src/services/notification.service.js
const Notification = require('../models/Notification');
const AppError = require('../utils/AppError');
const { iso, paginate } = require('../utils/serializers');

function toNotification(n) {
  const o = typeof n.toObject === 'function' ? n.toObject() : n;
  return {
    id: String(o._id),
    type: o.type || 'info',
    title: o.title,
    message: o.message || '',
    read: !!o.read,
    entityType: o.entityType || null,
    entityId: o.entityId || null,
    createdAt: iso(o.createdAt),
  };
}

async function listNotifications({ userId, page = 1, limit = 50, unreadOnly = false } = {}) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const filter = { userId };
  if (unreadOnly) filter.read = false;
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId, read: false }),
  ]);
  return { ...paginate(items.map(toNotification), { page, limit, total }), unread };
}

async function markRead(id, userId) {
  const n = await Notification.findOne({ _id: id, userId });
  if (!n) throw new AppError(404, 'Notification not found');
  n.read = true;
  await n.save();
  return toNotification(n);
}

async function markAllRead(userId) {
  const res = await Notification.updateMany({ userId, read: false }, { $set: { read: true } });
  return { updated: res.modifiedCount ?? res.nModified ?? 0 };
}

module.exports = { listNotifications, markRead, markAllRead, toNotification };
