// src/routes/framework.routes.js — /api/v1/frameworks (READ-ONLY; writes via governance)
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/framework.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

const ANY_AUTH = ['company_admin', 'sub_admin', 'regulator_admin', 'super_admin'];

router.get('/', requireAuth(ANY_AUTH), ctrl.listFrameworks);
router.get('/:id', requireAuth(ANY_AUTH), ctrl.getFramework);

module.exports = router;
