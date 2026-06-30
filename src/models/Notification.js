// src/models/Notification.js
// Per-user notifications (P5). Distinct from Alert (system-wide monitoring):
// these are addressed messages for a specific user (e.g. "your cert was issued").
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, default: 'info' }, // info | success | warning | governance | review | expiry ...
  title: { type: String, required: true },
  message: { type: String, default: '' },
  read: { type: Boolean, default: false, index: true },
  entityType: { type: String, default: null }, // 'document' | 'company' | 'proposal' | 'alert' ...
  entityId: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
