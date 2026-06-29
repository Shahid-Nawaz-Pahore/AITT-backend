const express = require('express');
const router = express.Router();
const auth = require('./auth.route');
const certificates = require('./certificates.route');
const company = require('./company.routes');    
const regulator = require('./regulator.routes');
const soroban = require('./soroban.routes');


router.use('/auth', auth);

router.use('/certificates', certificates);
router.use('/companies', company);
router.use('/regulators', regulator);
router.use('/soroban', soroban);

module.exports = router;
