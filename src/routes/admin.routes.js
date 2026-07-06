// src/routes/admin.routes.js — /api/v1/admin (ops: job triggers, audit)
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const auditController = require('../controllers/audit.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

// Manually trigger background jobs (also run by the in-process scheduler under a
// distributed lock in prod — see services/scheduler).
router.post('/jobs/expiry', requireAuth(['super_admin']), adminController.runExpiry);
router.post('/jobs/outbox', requireAuth(['super_admin']), adminController.runOutbox);
router.post('/jobs/reconcile', requireAuth(['super_admin']), adminController.runReconcile);

// Audit trail (who did what when — includes auth failures, D13).
router.get('/audit', requireAuth(['super_admin']), auditController.listAudit);

module.exports = router;
