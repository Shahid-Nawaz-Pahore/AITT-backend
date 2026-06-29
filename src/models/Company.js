const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  name: { type: String, required: true },
  contactEmail: { type: String },
  contactPhone: { type: String },
  walletAddress: { type: String },
  metadata: { type: Object }
}, { timestamps: true });

companySchema.index({ name: 'text', contactEmail: 1 });
module.exports = mongoose.model('Company', companySchema);
