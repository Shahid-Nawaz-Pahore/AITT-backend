const mongoose = require('mongoose');

const regulatorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  contactEmail: { type: String },
  walletAddress: { type: String, index: true },
  metadata: { type: Object }
}, { timestamps: true });

module.exports = mongoose.model('Regulator', regulatorSchema);
