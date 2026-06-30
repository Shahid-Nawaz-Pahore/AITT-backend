// src/controllers/notification.controller.js
const notificationService = require('../services/notification.service');

async function listNotifications(req, res, next) {
  try {
    const { page = 1, limit = 50, unreadOnly } = req.query;
    res.json({ success: true, ...(await notificationService.listNotifications({ userId: req.user.sub, page, limit, unreadOnly: unreadOnly === 'true' })) });
  } catch (err) { next(err); }
}

async function markRead(req, res, next) {
  try {
    res.json({ success: true, data: await notificationService.markRead(req.params.id, req.user.sub) });
  } catch (err) { next(err); }
}

async function markAllRead(req, res, next) {
  try {
    res.json({ success: true, ...(await notificationService.markAllRead(req.user.sub)) });
  } catch (err) { next(err); }
}

module.exports = { listNotifications, markRead, markAllRead };
