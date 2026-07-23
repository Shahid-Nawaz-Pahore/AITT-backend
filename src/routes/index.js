const express = require('express');
const router = express.Router();
const auth = require('./auth.route');
const certificates = require('./certificates.route');
const company = require('./company.routes');
const regulator = require('./regulator.routes');
const soroban = require('./soroban.routes');
const documents = require('./document.route');
const subAdmins = require('./subadmin.routes');
const proposals = require('./proposal.routes');
const governance = require('./governance.routes');
const frameworks = require('./framework.routes');
const compliancePrograms = require('./complianceProgram.routes');
const templates = require('./template.routes');
const alerts = require('./alert.routes');
const notifications = require('./notification.routes');
const admin = require('./admin.routes');
const { auditMiddleware } = require('../middlewares/audit.middleware');

// P5: record every successful state-changing request to the audit trail.
router.use(auditMiddleware);

router.use('/auth', auth);

router.use('/certificates', certificates);
router.use('/companies', company);
router.use('/regulators', regulator);
router.use('/soroban', soroban);
// P3: document lifecycle (the approved frontend's /documents surface) + reviewers.
router.use('/documents', documents);
router.use('/sub-admins', subAdmins);
// P4: multi-sig governance (proposals + N-of-M settings).
router.use('/proposals', proposals);
router.use('/governance', governance);
// P5: frameworks (read-only), templates (+.docx), alerts, notifications, admin/ops.
router.use('/frameworks', frameworks);
// Admin-managed AITT compliance programs (replaces external frameworks).
router.use('/compliance-programs', compliancePrograms);
router.use('/templates', templates);
router.use('/alerts', alerts);
router.use('/notifications', notifications);
router.use('/admin', admin);

module.exports = router;
