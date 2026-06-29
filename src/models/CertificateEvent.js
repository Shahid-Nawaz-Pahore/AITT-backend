const mongoose = require('mongoose');

const certEventSchema = new mongoose.Schema({
  certificateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Certificate', required: true, index: true },
  type: { type: String, enum: ['requested', 'issued', 'validated', 'revoked', 'comment'], required: true },
  actor: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: { type: String }
  },
  details: { type: Object }
}, { timestamps: true });

module.exports = mongoose.model('CertificateEvent', certEventSchema);
