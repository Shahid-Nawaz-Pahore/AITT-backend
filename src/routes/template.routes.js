// src/routes/template.routes.js — /api/v1/templates (admin CRUD + .docx download)
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/template.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

const ANY_AUTH = ['company_admin', 'sub_admin', 'regulator_admin', 'super_admin'];

// List + download are available to any authenticated user (Submit screen).
router.get('/', requireAuth(ANY_AUTH), ctrl.listTemplates);
router.get('/:id', requireAuth(ANY_AUTH), ctrl.getTemplate);
router.get('/:id/download', requireAuth(ANY_AUTH), ctrl.downloadTemplate);

// Direct admin CRUD (templates are blank downloads, not a §3 multi-sig concern).
router.post('/', requireAuth(['super_admin']), ctrl.createTemplate);
router.put('/:id', requireAuth(['super_admin']), ctrl.updateTemplate);
router.delete('/:id', requireAuth(['super_admin']), ctrl.removeTemplate);

module.exports = router;
