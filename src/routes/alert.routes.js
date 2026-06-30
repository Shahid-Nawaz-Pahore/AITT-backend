// src/routes/alert.routes.js — /api/v1/alerts
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/alert.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

const MONITORS = ['super_admin', 'regulator_admin', 'sub_admin'];

router.get('/', requireAuth(MONITORS), ctrl.listAlerts);
router.post('/', requireAuth(['super_admin']), ctrl.createAlert);
router.post('/:id/resolve', requireAuth(MONITORS), ctrl.resolveAlert);

module.exports = router;
