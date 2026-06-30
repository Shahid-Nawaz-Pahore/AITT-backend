// src/migrations/seed-p5.js
// Seed default frameworks + templates if those collections are empty (P5).
// Idempotent. Run: node src/migrations/seed-p5.js
const mongoose = require('mongoose');
const Framework = require('../models/Framework');
const Template = require('../models/Template');
const logger = require('../utils/logger');

const DEFAULT_FRAMEWORKS = [
  { name: 'GDPR', description: 'EU General Data Protection Regulation' },
  { name: 'ISO/IEC 27001', description: 'Information security management' },
  { name: 'SOC 2', description: 'Service Organization Control 2' },
  { name: 'EU AI Act', description: 'EU Artificial Intelligence Act' },
  { name: 'HIPAA', description: 'US health information privacy' },
];

const DEFAULT_TEMPLATES = [
  { name: 'Compliance Audit Report', description: 'Blank audit report template', file: 'compliance-audit-report.docx' },
  { name: 'Data Processing Agreement', description: 'Blank DPA template', file: 'data-processing-agreement.docx' },
];

async function runSeed() {
  const out = { frameworks: 0, templates: 0 };
  if ((await Framework.countDocuments({})) === 0) {
    await Framework.insertMany(DEFAULT_FRAMEWORKS);
    out.frameworks = DEFAULT_FRAMEWORKS.length;
  }
  if ((await Template.countDocuments({})) === 0) {
    await Template.insertMany(DEFAULT_TEMPLATES);
    out.templates = DEFAULT_TEMPLATES.length;
  }
  logger.info('seed-p5 complete', out);
  return out;
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { dbName: 'soroban_compliance' });
  try {
    const out = await runSeed();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await mongoose.connection.close();
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { logger.error('seed-p5 failed', { error: e.message }); process.exit(1); });
}

module.exports = { runSeed, DEFAULT_FRAMEWORKS, DEFAULT_TEMPLATES };
