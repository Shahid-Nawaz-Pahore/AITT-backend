// src/routes/complianceProgram.routes.js — /api/v1/compliance-programs
// Read: any authenticated user (companies choose a program when submitting).
// Write: Main Admin (super_admin) only — create / edit / archive / delete /
// assign sub-admins. Sub-admins can never create or delete programs.
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/complianceProgram.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

const ANY_AUTH = ['company_admin', 'sub_admin', 'regulator_admin', 'super_admin'];
const MAIN_ADMIN = ['super_admin'];

router.get('/', requireAuth(ANY_AUTH), ctrl.list);
router.get('/:id', requireAuth(ANY_AUTH), ctrl.get);

router.post('/', requireAuth(MAIN_ADMIN), ctrl.create);
router.put('/:id', requireAuth(MAIN_ADMIN), ctrl.update);
router.post('/:id/archive', requireAuth(MAIN_ADMIN), ctrl.archive);
router.post('/:id/assignees', requireAuth(MAIN_ADMIN), ctrl.assign);
router.delete('/:id', requireAuth(MAIN_ADMIN), ctrl.remove);

module.exports = router;
