const express = require('express');
const router = express.Router();
const regulatorController = require('../controllers/regulator.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

router.post('/promote', requireAuth(['super_admin']), regulatorController.promoteUserToRegulatorAdmin);
router.post('/demote', requireAuth(['super_admin']), regulatorController.demoteRegulatorAdmin);
// Create new regulator (later: only super_admin should do this)
router.post('/', requireAuth(['super_admin']), regulatorController.createRegulator);
router.get('/users-grouped', requireAuth(['super_admin','regulator_admin']), regulatorController.getAllUsersGrouped);   
// List all regulators
router.get('/', requireAuth(['super_admin','regulator_admin']), regulatorController.listRegulators);

// Get single regulator
router.get('/:id', requireAuth(['super_admin', 'regulator_admin']), regulatorController.getRegulator);

module.exports = router;
