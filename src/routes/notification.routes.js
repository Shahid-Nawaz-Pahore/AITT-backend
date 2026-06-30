// src/routes/notification.routes.js — /api/v1/notifications (per-user)
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/notification.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

const ANY_AUTH = ['company_admin', 'sub_admin', 'regulator_admin', 'super_admin'];

router.get('/', requireAuth(ANY_AUTH), ctrl.listNotifications);
router.post('/read-all', requireAuth(ANY_AUTH), ctrl.markAllRead);
router.post('/:id/read', requireAuth(ANY_AUTH), ctrl.markRead);

module.exports = router;
