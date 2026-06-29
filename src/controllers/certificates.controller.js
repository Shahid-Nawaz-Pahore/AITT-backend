const crypto = require('crypto');
const multer = require('multer');
const certificateService = require('../services/certificate.service');
const logger = require('../utils/logger');

// Multer in-memory storage (no saving to disk)
const upload = multer({ storage: multer.memoryStorage() });

// controllers/certificate.controller.js (replace existing file)
const path = require('path');
const fs = require('fs');
// const { uploadSingle } = require('../utils/upload');
const hashFileSha256 = require('../utils/hashFile');

const { uploadSingle, DEST_DIR, CERT_UPLOAD_DIR, IS_DISK_UPLOAD } = require('../utils/upload');

const AppError = require('../utils/AppError');

/**
 * Middleware to use in routes:
 * router.post('/', auth, uploadSingle('file'), createCertificate)
 *
 * This handler supports both:
 * - Disk mode (USE_DISK_UPLOAD=true): req.file.path exists
 * - Memory mode (USE_DISK_UPLOAD=false): req.file.buffer exists (no disk writes)
 */
async function createCertificate(req, res, next) {
  // Basic validation up-front
  const { certificateName, subject } = req.body || {};
  if (!certificateName || !subject) {
    return res.status(400).json({ success: false, message: 'certificateName and subject are required' });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: 'File is required' });
  }

  // metadata (fields present for disk mode and for memory mode some missing)
  const savedPath = req.file.path || null;       // absolute path on disk (from multer) OR null in memory mode
  const filename = req.file.filename || (req.file.originalname ? (() => {
    // When memory mode, multer.memoryStorage doesn't create filename — keep original name for reference
    return req.file.originalname;
  })() : null);
  const originalFilename = req.file.originalname;
  const mimeType = req.file.mimetype;
  const size = req.file.size;

  // Build public URL only if disk storage is used and APP_PUBLIC_BASE_URL is set (backwards compatible)
  const base = (process.env.APP_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const publicUrl = (IS_DISK_UPLOAD && filename) ? (base ? `${base}/${CERT_UPLOAD_DIR}/${filename}` : `/${CERT_UPLOAD_DIR}/${filename}`) : null;

  // Wrap large operation in try/catch so we can cleanup file on failure (only if there is a savedPath)
  try {
    // compute sha256
    let hash;
    try {
      if (req.file.buffer) {
        // memory mode: compute hash directly from buffer
        hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
        logger.info('Computed SHA256 from memory buffer', { hashShort: hash.slice(0,16), size });
      } else if (savedPath) {
        // disk mode: compute hash using existing util (streamed) to avoid loading entire file into memory
        hash = await hashFileSha256(savedPath);
        logger.info('Computed SHA256 from disk file', { path: savedPath, hashShort: hash.slice(0,16), size });
      } else {
        // defensive: no buffer and no path
        logger.error('Uploaded file missing buffer and path', { file: req.file });
        return next(new AppError(500, 'Uploaded file inaccessible'));
      }
    } catch (err) {
      // hashing failure: remove uploaded file (best-effort) and return error (only if file was written)
      logger.error('Failed to hash uploaded file', { path: savedPath, error: err && err.message, stack: err && err.stack });
      if (savedPath) {
        try {
          fs.unlinkSync(savedPath);
          logger.info('Deleted uploaded file after hash failure', { path: savedPath });
        } catch (e) {
          logger.warn('Failed to delete file after hash failure', { path: savedPath, err: e && e.message });
        }
      }
      return next(new AppError(500, 'Failed to process uploaded file', err && err.message));
    }

    // call service — pass fileMeta & storageMeta only if present (don't force saving metadata when in-memory)
    let result;
    try {
      const fileMeta = {
        originalFilename,
        mimeType,
        size
      };

      // storageMeta present only if using disk mode (so DB gets an actual path/publicUrl). If memory mode, omit storageMeta.
      const storageMeta = savedPath ? {
        provider: 'local',
        path: savedPath,
        publicUrl
      } : undefined;

      result = await certificateService.createCertificate({
        certificateName,
        companyId: req.user && req.user.companyId,
        subject,
        metadataHash: hash,
        requestedByUserId: req.user && req.user.sub,
        fileMeta,
        storageMeta
      });
    } catch (err) {
      // Service failed: best-effort cleanup of uploaded file to avoid orphan files (only delete if on disk)
      logger.error('certificateService.createCertificate failed', { error: err && err.message, stack: err && err.stack });
      if (savedPath) {
        try {
          if (fs.existsSync(savedPath)) {
            fs.unlinkSync(savedPath);
            logger.info('Deleted uploaded file after service failure', { path: savedPath });
          }
        } catch (cleanupErr) {
          logger.warn('Failed to delete uploaded file after service failure', { path: savedPath, err: cleanupErr && cleanupErr.message });
        }
      }
      return next(err); // propagate error to global handler
    }

    const { cert, tx } = result || {};
    logger.info('Certificate created & issued', {
      certificateId: cert && cert._id,
      companyId: req.user && req.user.companyId,
      userId: req.user && req.user.sub,
      txHash: tx && tx.txHash,
      storage: savedPath ? { path: savedPath, publicUrl } : { mode: IS_DISK_UPLOAD ? 'disk' : 'memory' }
    });

    return res.status(201).json({ success: true, cert, tx });
  } catch (err) {
    // unexpected errors
    logger.error('Unexpected error in createCertificate controller', { error: err && err.message, stack: err && err.stack, raw: err });
    return next(err);
  }
}


/**
 * Middleware to use in routes:
 * router.post('/', auth, uploadSingle('file'), createCertificate)
 */

/**
 * Usage in routes:
 * router.post('/', auth.ensureLoggedIn, uploadMiddleware, createCertificate)
 */

// async function createCertificate(req, res, next) {
//   // Basic validation up-front
//   const { certificateName, subject } = req.body || {};
//   if (!certificateName || !subject) {
//     return res.status(400).json({ success: false, message: 'certificateName and subject are required' });
//   }

//   if (!req.file) {
//     return res.status(400).json({ success: false, message: 'File is required' });
//   }

//   const savedPath = req.file.path;       // absolute path on disk (from multer)
//   const filename = req.file.filename;
//   const originalFilename = req.file.originalname;
//   const mimeType = req.file.mimetype;
//   const size = req.file.size;

//   // Build public URL (no trailing slash)
//   const base = (process.env.APP_PUBLIC_BASE_URL || '').replace(/\/$/, '');
//   const publicUrl = base ? `${base}/certificates/${filename}` : `/certificates/${filename}`;

//   // Wrap large operation in try/catch so we can cleanup file on failure
//   try {
//     // compute sha256 from saved file (streamed)
//     let hash;
//     try {
//       hash = await hashFileSha256(savedPath);
//     } catch (err) {
//       // hashing failure: remove uploaded file (best-effort) and return error
//       logger.error('Failed to hash uploaded file', { path: savedPath, error: err && err.message, stack: err && err.stack });
//       try { fs.unlinkSync(savedPath); logger.info('Deleted uploaded file after hash failure', { path: savedPath }); } catch (e) { logger.warn('Failed to delete file after hash failure', { path: savedPath, err: e && e.message }); }
//       return next(new Error('Failed to process uploaded file'));
//     }

//     // call service — pass fileMeta & storageMeta
//     let result;
//     try {
//       result = await certificateService.createCertificate({
//         certificateName,
//         companyId: req.user && req.user.companyId,
//         subject,
//         metadataHash: hash,
//         requestedByUserId: req.user && req.user.sub,
//         fileMeta: {
//           originalFilename,
//           mimeType,
//           size
//         },
//         storageMeta: {
//           provider: 'local',
//           path: savedPath,
//           publicUrl
//         }
//       });
//     } catch (err) {
//       // Service failed: best-effort cleanup of uploaded file to avoid orphan files
//       logger.error('certificateService.createCertificate failed', { error: err && err.message, stack: err && err.stack });
//       try {
//         if (fs.existsSync(savedPath)) {
//           fs.unlinkSync(savedPath);
//           logger.info('Deleted uploaded file after service failure', { path: savedPath });
//         }
//       } catch (cleanupErr) {
//         logger.warn('Failed to delete uploaded file after service failure', { path: savedPath, err: cleanupErr && cleanupErr.message });
//       }
//       return next(err); // propagate error to global handler
//     }

//     const { cert, tx } = result || {};
//     logger.info('Certificate created & issued', {
//       certificateId: cert && cert._id,
//       companyId: req.user && req.user.companyId,
//       userId: req.user && req.user.sub,
//       txHash: tx && tx.txHash
//     });

//     return res.status(201).json({ success: true, cert, tx });
//   } catch (err) {
//     // unexpected errors
//     logger.error('Unexpected error in createCertificate controller', { error: err && err.message, stack: err && err.stack, raw: err });
//     return next(err);
//   }
// }

/**
 * Check if a certificate is issued (file upload + hash verify)
 */
async function checkCertificateIssued(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'File is required' });
    }

    // 🔹 Compute SHA-256 hash
    const fileBuffer = req.file.buffer;
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    const { issued, value } = await certificateService.checkCertificateIssued(hash);

    res.json({ success: true, issued, value });
  } catch (err) {
    logger.error('Error checking certificate issued', { error: err.message });
    next(err);
  }
}

/**
 * Get all certificates (super_admin only)
 * Supports pagination, filtering, and search
 */
async function getAllCertificates(req, res, next) {
  try {
    const {
      page = 1,
      limit = 50,
      status,
      companyId,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (companyId) filters.companyId = companyId;
    if (search) {
      filters.$or = [
        { certificateName: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } },
        { originalFilename: { $regex: search, $options: 'i' } }
      ];
    }

    const result = await certificateService.getAllCertificates({
      filters,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sortBy,
      sortOrder
    });

    const userId = req.user?.sub || 'unknown';

    logger.info('Admin fetched certificates', {
      userId,
      filters,
      page,
      limit,
      totalFound: result.total
    });

    return res.json({
      success: true,
      data: result.certificates,
      pagination: {
        currentPage: result.currentPage,
        totalPages: result.totalPages,
        total: result.total,
        limit: result.limit
      }
    });
  } catch (err) {
    logger.error('getAllCertificates failed', { 
      error: err.message, 
      stack: err.stack,
      userId: req.user?.sub || 'unknown'
    });
    return next(err);
  }
}


/**
 * Get single certificate by ID (super_admin only)
 */
async function getCertificateById(req, res, next) {
  try {
    const { id } = req.params;

    const certificate = await certificateService.getCertificateById(id);
    
    if (!certificate) {
      return res.status(404).json({
        success: false,
        message: 'Certificate not found'
      });
    }

    logger.info('Admin fetched certificate by ID', {
      userId: req.user.sub,
      certificateId: id
    });

    return res.json({
      success: true,
      data: certificate
    });
  } catch (err) {
    logger.error('getCertificateById failed', { 
      error: err.message, 
      stack: err.stack,
      certificateId: req.params.id,
      userId: req.user?.sub
    });
    return next(err);
  }
}

/**
 * Update certificate (super_admin only)
 * Can update certificateName and optionally replace file
 */
async function updateCertificate(req, res, next) {
  try {
    const { id } = req.params;
    const { certificateName, subject } = req.body;

    // Basic validation
    if (!certificateName && !subject && !req.file) {
      return res.status(400).json({
        success: false,
        message: 'At least one field (certificateName, subject) or file must be provided for update'
      });
    }

    const updateData = {};
    if (certificateName) updateData.certificateName = certificateName;
    if (subject) updateData.subject = subject;

    // If new file is uploaded, process it
    let newFileMeta = null;
    let newStorageMeta = null;
    let newHash = null;

    if (req.file) {
      const savedPath = req.file.path;
      const filename = req.file.filename;
      const originalFilename = req.file.originalname;
      const mimeType = req.file.mimetype;
      const size = req.file.size;

      // Build public URL
      const base = (process.env.APP_PUBLIC_BASE_URL || '').replace(/\/$/, '');
      const publicUrl = base ? `${base}/certificates/${filename}` : `/certificates/${filename}`;

      try {
        // Compute hash for new file
        newHash = await hashFileSha256(savedPath);
        
        newFileMeta = { originalFilename, mimeType, size };
        newStorageMeta = {
          provider: 'local',
          path: savedPath,
          publicUrl
        };
        updateData.metadataHash = newHash;
      } catch (hashErr) {
        // Clean up uploaded file if hashing fails
        logger.error('Failed to hash new uploaded file', { 
          path: savedPath, 
          error: hashErr.message 
        });
        try { fs.unlinkSync(savedPath); } catch (e) { /* ignore cleanup errors */ }
        return res.status(500).json({
          success: false,
          message: 'Failed to process uploaded file'
        });
      }
    }

    const result = await certificateService.updateCertificate(id, {
      updateData,
      newFileMeta,
      newStorageMeta,
      updatedByUserId: req.user.sub
    });

    logger.info('Certificate updated by admin', {
      userId: req.user.sub,
      certificateId: id,
      hasNewFile: !!req.file,
      updatedFields: Object.keys(updateData)
    });

    return res.json({
      success: true,
      data: result.certificate,
      message: 'Certificate updated successfully'
    });

  } catch (err) {
    logger.error('updateCertificate failed', { 
      error: err.message, 
      stack: err.stack,
      certificateId: req.params.id,
      userId: req.user?.sub
    });

    // Clean up uploaded file if service fails
    if (req.file?.path) {
      try {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
          logger.info('Cleaned up uploaded file after service failure', { 
            path: req.file.path 
          });
        }
      } catch (cleanupErr) {
        logger.warn('Failed to clean up uploaded file', { 
          path: req.file.path, 
          error: cleanupErr.message 
        });
      }
    }

    return next(err);
  }
}

/**
 * Delete certificate (super_admin only)
 * Removes certificate and all related records, cleans up files
 */
async function deleteCertificate(req, res, next) {
  try {
    const { id } = req.params;

    const result = await certificateService.deleteCertificate(id, {
      deletedByUserId: req.user.sub
    });

    logger.info('Certificate deleted by admin', {
      userId: req.user.sub,
      certificateId: id,
      deletedCounts: result.deletedCounts
    });

    return res.json({
      success: true,
      message: 'Certificate and related records deleted successfully',
      deletedCounts: result.deletedCounts
    });

  } catch (err) {
    logger.error('deleteCertificate failed', { 
      error: err.message, 
      stack: err.stack,
      certificateId: req.params.id,
      userId: req.user?.sub
    });
    return next(err);
  }
}

async function getCertificate(req, res, next) {
  try {
    const { id } = req.params;
    const cert = await certificateService.getCertificate(id);

    if (!cert) {
      logger.warn('Certificate not found', { certificateId: id });
      return res.status(404).json({ success: false, message: 'Certificate not found' });
    }

    logger.info('Certificate fetched', { certificateId: id, userId: req.user.sub });

    res.json({ success: true, data: cert });
  } catch (err) {
    logger.error('Error fetching certificate', { error: err.message, certificateId: req.params.id });
    next(err);
  }
}

async function issueCertificate(req, res, next) {
  try {
    const { id } = req.params;
    const { notes, expiryAt } = req.body;

    const result = await certificateService.issueCertificate({
      certificateId: id,
      issuedByUserId: req.user.sub,
      notes,
      expiryAt,
    });

    logger.info('Certificate issued', {
      certificateId: id,
      issuedBy: req.user.sub,
      txId: result.tx?._id || null,
    });

    res.json({ success: true, data: { certificate: result.cert, tx: result.tx } });
  } catch (err) {
    logger.error('Error issuing certificate', { error: err.message, certificateId: req.params.id });
    next(err);
  }
}

async function validateCertificate(req, res, next) {
  try {
    const { id } = req.params;
    const result = await certificateService.validateCertificate({
      certificateId: id,
      validatorUserId: req.user.sub,
    });

    logger.info('Certificate validated', {
      certificateId: id,
      validatorId: req.user.sub,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('Error validating certificate', { error: err.message, certificateId: req.params.id });
    next(err);
  }
}

async function verifyPublic(req, res, next) {
  try {
    const { id } = req.params;
    const cert = await certificateService.getCertificate(id);

    if (!cert) {
      logger.warn('Public verification failed: certificate not found', { certificateId: id });
      return res.status(404).json({ success: false, message: 'Certificate not found' });
    }

    logger.info('Certificate publicly verified', { certificateId: id });

    res.json({
      success: true,
      data: {
        certificate: cert,
        chain: cert.chain || null, // future: include on-chain status
      },
    });
  } catch (err) {
    logger.error('Error in public verification', { error: err.message, certificateId: req.params.id });
    next(err);
  }
}

module.exports = {
  createCertificate,
  uploadMiddleware: uploadSingle('file'),
  checkCertificateIssued,
  getAllCertificates,
  getCertificateById,
  updateCertificate,
  deleteCertificate,
  upload,
  getCertificate,
  issueCertificate,
  validateCertificate,
  verifyPublic,
};
