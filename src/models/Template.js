// src/models/Template.js
// ---------------------------------------------------------------------------
// A downloadable document template (blank .docx). Mirrors
// frontend-aitt/src/mock/types.ts -> `Template` (id, name, description, file).
//
// `file` is the blank .docx filename surfaced to the frontend; storage holds
// the backend-only physical location wired up for download in P5.
// ---------------------------------------------------------------------------
const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },

  // Frontend `file` — the blank .docx filename.
  file: { type: String, required: true },

  // Backend-only storage info (populated when a real file is attached in P5).
  storage: {
    provider: { type: String, enum: ['local', 's3', 'minio', 'gridfs'], default: 'local' },
    path: { type: String, default: null },
    publicUrl: { type: String, default: null },
    mimeType: { type: String, default: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    size: { type: Number, default: null },
  },
}, { timestamps: true });

module.exports = mongoose.model('Template', templateSchema);
