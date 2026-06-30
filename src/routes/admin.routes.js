// src/routes/admin.routes.js — /api/v1/admin (ops: job triggers, audit)
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const auditController = require('../controllers/audit.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

// Manually trigger the expiry job (also wire to a scheduler/cron in prod).
router.post('/jobs/expiry', requireAuth(['super_admin']), adminController.runExpiry);

// Audit trail (who did what when).
router.get('/audit', requireAuth(['super_admin']), auditController.listAudit);

module.exports = router;
