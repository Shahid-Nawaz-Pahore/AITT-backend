// src/routes/subadmin.routes.js
// /api/v1/sub-admins — reviewer management (admin only).
const express = require('express');
const router = express.Router();
const subadminController = require('../controllers/subadmin.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

// Invite a sub-admin (creates DB profile + custodial wallet + login).
router.post('/', requireAuth(['super_admin']), subadminController.inviteSubAdmin);

// List sub-admins (admins + reviewers).
router.get('/', requireAuth(['super_admin', 'regulator_admin', 'sub_admin']), subadminController.listSubAdmins);

// Activate on chain (add_sub_admin) -> can review/approve.
router.post('/:id/activate', requireAuth(['super_admin']), subadminController.activateSubAdmin);

// Remove a sub-admin.
router.delete('/:id', requireAuth(['super_admin']), subadminController.removeSubAdmin);

module.exports = router;
