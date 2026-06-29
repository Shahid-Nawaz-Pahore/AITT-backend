// src/services/certificate.service.js
const Certificate = require('../models/Certificate');
const CertificateEvent = require('../models/CertificateEvent');
const Web3Tx = require('../models/Web3Tx');
const sorobanService = require('./soroban.service');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const fs = require('fs');



/**
 * createCertificate
 * - performs on-chain storeDocument call
 * - persists certificate + web3 tx + event
 * - accepts fileMeta and storageMeta to persist file info
 */
async function createCertificate({
  certificateName,
  companyId,
  subject,
  metadataHash,
  requestedByUserId,
  network = 'testnet',
  signerSecret = null,
  fileMeta = null,
  storageMeta = null
}) {
  // basic validation
  if (!certificateName || !metadataHash || !subject) {
    throw new AppError(400, 'Missing required fields: certificateName, subject, metadataHash');
  }
  
  // Check if document with same hash already exists on chain
  try {
    logger.info('Checking existing document on chain', { metadataHashShort: metadataHash.slice(0, 16) });
    const existing = await sorobanService.readDocument(metadataHash);
    console.log('Existing on chain:', existing);
    if (existing) {
      throw new AppError(400, 'A document with the same metadataHash already exists on chain');
    }
  } catch (err) {
    // If it's already an AppError with status 400, re-throw it (document exists case)
    if (err instanceof AppError && err.statusCode === 400) {
      throw err;
    }
    // Otherwise, it's a network/system error
    logger.error('Failed to check existing document on chain', { error: err && err.message, stack: err && err.stack });
    throw new AppError(500, 'Failed to verify existing document on chain', err && err.message);
  }

  logger.info('Creating certificate', {
    certificateName, companyId, subject, requestedByUserId
  });

  try {
    // ---- Call Soroban (optionally with signerSecret) ----
    let receipt;
    try {
      receipt = await sorobanService.storeDocument(certificateName, metadataHash, signerSecret);
    } catch (err) {
      logger.error('sorobanService.storeDocument threw an error', { error: err && err.message, stack: err && err.stack });
      throw new AppError(502, 'Blockchain store_document call failed', err && err.message);
    }

    if (!receipt || receipt.status !== 'SUCCESS') {
      logger.error('On-chain store_document failed', { receipt });
      throw new AppError(500, 'Blockchain store_document failed');
    }

    const txHash = receipt.hash || receipt.txHash;
    if (!txHash) {
      logger.error('Missing txHash in blockchain receipt', { receipt });
      throw new AppError(500, 'Missing txHash from blockchain receipt');
    }

    // ---- Create DB record: include file meta + storage meta ----
    const certData = {
      certificateName,
      companyId,
      subject,
      metadataHash,
      status: 'issued',
      chain: {
        txHashIssue: txHash,
        onChainId: txHash,
        network
      },
      requestedByUserId
    };

    if (fileMeta) {
      certData.originalFilename = fileMeta.originalFilename;
      certData.mimeType = fileMeta.mimeType;
      certData.size = fileMeta.size;
    }

    if (storageMeta) {
      certData.storage = {
        provider: storageMeta.provider || 'local',
        path: storageMeta.path,
        publicUrl: storageMeta.publicUrl
      };
      certData.certificateUrl = storageMeta.publicUrl; // backward compat
    }

    let cert;
    try {
      cert = await Certificate.create(certData);
    } catch (err) {
      logger.error('Failed to create Certificate DB record', { error: err && err.message, stack: err && err.stack, certData });
      throw new AppError(500, 'Failed to persist certificate record', err && err.message);
    }

    // create web3 tx record for auditing (best-effort; if this fails we still return cert but log)
    let tx;
    try {
      tx = await Web3Tx.create({
        network,
        purpose: 'issue',
        certificateId: cert._id,
        submittedByUserId: requestedByUserId,
        txHash,
        status: 'confirmed',
        responseDump: receipt
      });
    } catch (err) {
      logger.error('Failed to create Web3Tx record', { error: err && err.message, stack: err && err.stack, certId: cert._id });
      // do not throw; we already have the cert persisted. Return cert and warn the caller via logs.
    }

    // certificate event (best-effort)
    try {
      await CertificateEvent.create({
        certificateId: cert._id,
        type: 'issued',
        actor: { userId: requestedByUserId, role: 'company_admin' },
        details: { txHash }
      });
    } catch (err) {
      logger.warn('Failed to create CertificateEvent', { error: err && err.message, stack: err && err.stack, certId: cert._id });
      // don't fail the whole flow for event creation issues
    }

    logger.info('Certificate issued successfully', { certId: cert._id, txHash });
    return { cert, tx };
  } catch (err) {
    logger.error('createCertificate failed', { error: err && err.message, stack: err && err.stack });
    // Re-throw AppError or wrap generic errors
    throw err instanceof AppError ? err : new AppError(500, 'createCertificate failed', err && err.message);
  }
}


/**
 * Verify if a document exists on chain
 */
async function checkCertificateIssued(hash, signerSecret = null) {
  logger.info('Checking certificate issued status', { hashShort: (hash || '').slice(0, 16) });
  try {
    const value = await sorobanService.verifyDocument(hash, signerSecret);
    const issued = !!value;

    logger.info('Certificate verification result', { hashShort: (hash || '').slice(0, 16), issued });
    return { issued, value };
  } catch (err) {
    logger.error('checkCertificateIssued failed', { error: err.message });
    throw err instanceof AppError ? err : new AppError(500, 'checkCertificateIssued failed', err.message);
  }
}


async function getAllCertificates({
  filters = {},
  page = 1,
  limit = 50,
  sortBy = 'createdAt',
  sortOrder = 'desc'
}) {
  try {
    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    // Execute query with population of company (only needed fields)
    const certificates = await Certificate
      .find(filters)
      .populate('companyId', 'name') // only bring company.name and _id
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();

    // Get total count for pagination
    const total = await Certificate.countDocuments(filters);
    const totalPages = Math.ceil(total / limit);

    const certIds = certificates.map(c => c._id);

    // Fetch latest 'issued' event per certificate in one query (we'll pick first per cert after sorting)
    const events = await CertificateEvent.find({
      certificateId: { $in: certIds },
      type: 'issued'
    }).sort({ createdAt: -1 }).lean();

    // Build a map latestEventByCertId -> event
    const latestEventByCertId = {};
    for (const ev of events) {
      const cid = String(ev.certificateId);
      if (!latestEventByCertId[cid]) latestEventByCertId[cid] = ev; // first encountered is latest due to sort
    }

    // Map to compact DTO
    const compact = certificates.map(c => {
      const cid = String(c._id);
      const ev = latestEventByCertId[cid] || null;

      return {
        id: c._id,
        certificateName: c.certificateName || null,
        subject: c.subject || null,
        company: c.companyId ? { id: c.companyId._id, name: c.companyId.name } : null,
        issuedAt: c.createdAt || null,
        txHash: c.chain?.txHashIssue || null,
        onChainId: c.chain?.onChainId || null,
        fileName: c.originalFilename || null,
        fileUrl: c.certificateUrl || c.storage?.publicUrl || null,
        mimeType: c.mimeType || null,
        size: c.size || null,
        // Prefer actor.userId from the 'issued' event (the signer), otherwise fall back to requestedByUserId
        signedBy: ev?.actor?.userId || c.requestedByUserId || null,
        signerRole: ev?.actor?.role || null
      };
    });

    logger.info('Retrieved certificates (compact)', {
      filters,
      page,
      limit,
      total,
      returned: compact.length
    });

    return {
      certificates: compact,
      currentPage: page,
      totalPages,
      total,
      limit
    };
  } catch (err) {
    logger.error('getAllCertificates service failed', {
      error: err.message,
      stack: err.stack,
      filters
    });
    throw new AppError(500, 'Failed to retrieve certificates', err.message);
  }
}


/**
 * Get single certificate by ID with related data
 */
async function getCertificateById(certificateId) {
  try {
    const certificate = await Certificate
      .findById(certificateId)
      .populate('companyId', 'name email')
      .lean();

    if (!certificate) {
      throw new AppError(404, 'Certificate not found');
    }

    // Get related events and transactions
    const [events, transactions] = await Promise.all([
      CertificateEvent
        .find({ certificateId })
        .populate('actor.userId', 'name email')
        .sort({ createdAt: -1 })
        .lean(),
      Web3Tx
        .find({ certificateId })
        .sort({ createdAt: -1 })
        .lean()
    ]);

    logger.info('Retrieved certificate by ID', {
      certificateId,
      eventsCount: events.length,
      transactionsCount: transactions.length
    });

    return {
      ...certificate,
      events,
      transactions
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    
    logger.error('getCertificateById service failed', {
      error: err.message,
      stack: err.stack,
      certificateId
    });
    throw new AppError(500, 'Failed to retrieve certificate', err.message);
  }
}

/**
 * Update certificate with optional file replacement
 */
async function updateCertificate(certificateId, {
  updateData,
  newFileMeta = null,
  newStorageMeta = null,
  updatedByUserId
}) {
  try {
    // First, get the existing certificate to access old file info
    const existingCert = await Certificate.findById(certificateId);
    if (!existingCert) {
      throw new AppError(404, 'Certificate not found');
    }

    let oldFilePath = null;
    
    // If we're updating the file, prepare to clean up the old one
    if (newFileMeta && newStorageMeta) {
      // Store old file path for cleanup
      if (existingCert.storage?.path) {
        oldFilePath = existingCert.storage.path;
      }

      // Add file metadata to update data
      updateData.originalFilename = newFileMeta.originalFilename;
      updateData.mimeType = newFileMeta.mimeType;
      updateData.size = newFileMeta.size;
      updateData.storage = {
        provider: newStorageMeta.provider,
        path: newStorageMeta.path,
        publicUrl: newStorageMeta.publicUrl
      };
      updateData.certificateUrl = newStorageMeta.publicUrl; // backward compat
    }

    // Update the certificate
    const updatedCert = await Certificate.findByIdAndUpdate(
      certificateId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('companyId', 'name email');

    if (!updatedCert) {
      throw new AppError(404, 'Certificate not found');
    }

    // Clean up old file if we replaced it
    if (oldFilePath && newFileMeta) {
      try {
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
          logger.info('Deleted old certificate file', { oldPath: oldFilePath });
        }
      } catch (cleanupErr) {
        logger.warn('Failed to delete old certificate file', {
          oldPath: oldFilePath,
          error: cleanupErr.message
        });
        // Don't fail the update for file cleanup issues
      }
    }

    // Create update event
    try {
      const eventDetails = {
        updatedFields: Object.keys(updateData),
        hasNewFile: !!newFileMeta
      };

      await CertificateEvent.create({
        certificateId,
        type: 'comment', // using comment type for updates
        actor: {
          userId: updatedByUserId,
          role: 'super_admin'
        },
        details: {
          action: 'updated',
          ...eventDetails
        }
      });
    } catch (eventErr) {
      logger.warn('Failed to create update event', {
        error: eventErr.message,
        certificateId
      });
    }

    logger.info('Certificate updated successfully', {
      certificateId,
      updatedFields: Object.keys(updateData),
      hasNewFile: !!newFileMeta,
      updatedByUserId
    });

    return { certificate: updatedCert };

  } catch (err) {
    if (err instanceof AppError) throw err;

    logger.error('updateCertificate service failed', {
      error: err.message,
      stack: err.stack,
      certificateId
    });
    throw new AppError(500, 'Failed to update certificate', err.message);
  }
}

/**
 * Delete certificate and all related records
 * Performs complete cleanup: cert, events, transactions, files
 */
async function deleteCertificate(certificateId, { deletedByUserId }) {
  try {
    // Get certificate first to access file paths
    const certificate = await Certificate.findById(certificateId);
    if (!certificate) {
      throw new AppError(404, 'Certificate not found');
    }

    const filePath = certificate.storage?.path;
    const deletedCounts = {
      certificate: 0,
      events: 0,
      transactions: 0,
      filesDeleted: 0
    };

    // Delete related records first (in parallel for efficiency)
    const [eventsResult, transactionsResult] = await Promise.all([
      CertificateEvent.deleteMany({ certificateId }),
      Web3Tx.deleteMany({ certificateId })
    ]);

    deletedCounts.events = eventsResult.deletedCount || 0;
    deletedCounts.transactions = transactionsResult.deletedCount || 0;

    // Delete the main certificate record
    const certResult = await Certificate.findByIdAndDelete(certificateId);
    if (certResult) {
      deletedCounts.certificate = 1;
    }

    // Clean up file system
    if (filePath) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deletedCounts.filesDeleted = 1;
          logger.info('Deleted certificate file', { filePath });
        }
      } catch (fileErr) {
        logger.error('Failed to delete certificate file', {
          filePath,
          error: fileErr.message
        });
        // Continue - don't fail deletion for file cleanup issues
      }
    }

    logger.info('Certificate and related records deleted', {
      certificateId,
      deletedByUserId,
      deletedCounts
    });

    return { deletedCounts };

  } catch (err) {
    if (err instanceof AppError) throw err;

    logger.error('deleteCertificate service failed', {
      error: err.message,
      stack: err.stack,
      certificateId
    });
    throw new AppError(500, 'Failed to delete certificate', err.message);
  }
}

/**
 * Initialize smart contract (owner or given signer)
 */
async function initContract(signerSecret = null, performedByUserId = null) {
  logger.info('Initializing certificate contract', { signerShort: signerSecret ? 'provided' : 'default-service' });

  try {
    const receipt = await sorobanService.initContract(signerSecret);

    if (!receipt || receipt.status !== 'SUCCESS') {
      logger.error('initContract - blockchain call failed', { receipt });
      throw new AppError(500, 'Blockchain initContract failed');
    }

    // save tx audit
    await Web3Tx.create({
      network: 'testnet',
      purpose: 'init',
      txHash: receipt.hash,
      status: receipt.status.toLowerCase(),
      responseDump: receipt,
      submittedByUserId: performedByUserId
    });

    logger.info('Contract initialized successfully', { txHash: receipt.hash });
    return receipt;
  } catch (err) {
    logger.error('initContract failed', { error: err.message });
    throw err instanceof AppError ? err : new AppError(500, 'initContract failed', err.message);
  }
}

/* ---------------- Read-only wrappers ---------------- */

/**
 * readDocument(hash) -> returns normalized contract object or null
 */
async function readDocument(hash) {
  logger.info('readDocument', { hashShort: (hash || '').slice(0, 16) });
  try {
    const result = await sorobanService.readDocument(hash);
    logger.info('readDocument result', { hashShort: (hash || '').slice(0, 16), exists: result !== null });
    return result;
  } catch (err) {
    logger.error('readDocument failed', { error: err.message });
    throw err instanceof AppError ? err : new AppError(500, 'readDocument failed', err.message);
  }
}

/**
 * isAddressWhitelisted(address) -> boolean
 */
async function isAddressWhitelisted(address) {
  logger.info('isAddressWhitelisted', { addrShort: address?.slice?.(0, 8) ?? null });
  try {
    const val = await sorobanService.isWhitelisted(address);
    return !!val;
  } catch (err) {
    logger.error('isAddressWhitelisted failed', { error: err.message });
    throw err instanceof AppError ? err : new AppError(500, 'isAddressWhitelisted failed', err.message);
  }
}

/* ---------------- Write / admin operations ---------------- */

/**
 * whitelistAddress(address, signerSecret, performedByUserId)
 * - signerSecret: optional secret used to sign the tx (defaults to service key)
 */
async function whitelistAddress(address, signerSecret = null, performedByUserId = null) {
  logger.info('whitelistAddress start', { addrShort: address?.slice?.(0,8) ?? null });
  try {
    const receipt = await sorobanService.whitelistAddress(address, signerSecret);

    // save web3 tx - ensure Web3Tx enum supports 'whitelist'
    await Web3Tx.create({
      network: 'testnet',
      purpose: 'whitelist',
      txHash: receipt.hash,
      status: receipt.status.toLowerCase(),
      responseDump: receipt,
      submittedByUserId: performedByUserId
    });

    logger.info('whitelistAddress success', { addrShort: address?.slice?.(0,8), txHash: receipt.hash });
    return receipt;
  } catch (err) {
    logger.error('whitelistAddress failed', { error: err.message });
    throw err instanceof AppError ? err : new AppError(500, 'whitelistAddress failed', err.message);
  }
}

/**
 * removeFromWhitelist(address, signerSecret, performedByUserId)
 */
async function removeFromWhitelist(address, signerSecret = null, performedByUserId = null) {
  logger.info('removeFromWhitelist start', { addrShort: address?.slice?.(0,8) ?? null });
  try {
    const receipt = await sorobanService.removeFromWhitelist(address, signerSecret);

    await Web3Tx.create({
      network: 'testnet',
      purpose: 'remove_whitelist',
      txHash: receipt.hash,
      status: receipt.status.toLowerCase(),
      responseDump: receipt,
      submittedByUserId: performedByUserId
    });

    logger.info('removeFromWhitelist success', { addrShort: address?.slice?.(0,8), txHash: receipt.hash });
    return receipt;
  } catch (err) {
    logger.error('removeFromWhitelist failed', { error: err.message });
    throw err instanceof AppError ? err : new AppError(500, 'removeFromWhitelist failed', err.message);
  }
}

/**
 * transferOwnership(newOwner, signerSecret, performedByUserId)
 */
async function transferOwnership(newOwner, signerSecret = null, performedByUserId = null) {
  logger.info('transferOwnership start', { newOwnerShort: newOwner?.slice?.(0,8) ?? null });
  try {
    const receipt = await sorobanService.transferOwnership(newOwner, signerSecret);

    await Web3Tx.create({
      network: 'testnet',
      purpose: 'transfer',
      txHash: receipt.hash,
      status: receipt.status.toLowerCase(),
      responseDump: receipt,
      submittedByUserId: performedByUserId
    });

    logger.info('transferOwnership success', { newOwnerShort: newOwner?.slice?.(0,8), txHash: receipt.hash });
    return receipt;
  } catch (err) {
    logger.error('transferOwnership failed', { error: err.message });
    throw err instanceof AppError ? err : new AppError(500, 'transferOwnership failed', err.message);
  }
}

/* ---------------- Wallet helpers ---------------- */

function createWallet() {
  try {
    const wallet = sorobanService.createWallet();
    logger.info('createWallet', { pubShort: wallet.public_key?.slice?.(0,8) ?? null });
    return wallet;
  } catch (err) {
    logger.error('createWallet failed', { error: err.message });
    throw err instanceof AppError ? err : new AppError(500, 'createWallet failed', err.message);
  }
}

async function fundWallet(publicKey) {
  try {
    const result = await sorobanService.fundWallet(publicKey);
    logger.info('fundWallet success', { pubShort: publicKey?.slice?.(0,8) ?? null });
    return result;
  } catch (err) {
    logger.error('fundWallet failed', { error: err.message });
    throw err instanceof AppError ? err : new AppError(500, 'fundWallet failed', err.message);
  }
}

/* ---------------- Exports ---------------- */





/**
 * Fetch certificate with company populated
 */
async function getCertificate(id) {
  const cert = await Certificate.findById(id).populate('companyId');
  if (!cert) throw new AppError('Certificate not found', 404);
  return cert;
}

/**
 * Issue a certificate on chain
 */
async function issueCertificate({ certificateId, issuedByUserId, network = 'testnet', notes = null, expiryAt = null }) {
  logger.info(`Issuing certificate=${certificateId} on network=${network}`);

  const cert = await Certificate.findById(certificateId);
  if (!cert) throw new AppError('Certificate not found', 404);
  if (cert.status === 'issued') throw new AppError('Certificate already issued', 400);

  if (expiryAt && new Date(expiryAt) <= new Date()) {
    throw new AppError('Expiry date must be in the future', 400);
  }

  // Create web3 tx record
  const tx = await Web3Tx.create({
    network,
    purpose: 'issue',
    certificateId: cert._id,
    submittedByUserId: issuedByUserId,
    status: 'submitted',
    requestDump: { notes },
  });

  // ---- Blockchain call ----
  const receipt = await web3Service.issueCertificateOnChain({
    certificateId: cert._id.toString(),
    network,
    metadataHash: cert.metadataHash,
    expiryAt,
  });

  // Update tx info
  tx.txHash = receipt.txHash;
  tx.status = receipt.success ? 'confirmed' : 'failed';
  tx.responseDump = receipt;
  await tx.save();

  if (!receipt.success) {
    logger.error('Blockchain issuance failed', { certId: cert._id, receipt });
    throw new AppError('Blockchain issuance failed', 500, receipt);
  }

  // Update certificate
  cert.status = 'issued';
  cert.chain = {
    ...(cert.chain || {}),
    txHashIssue: receipt.txHash,
    onChainId: receipt.onChainId || receipt.txHash, // fallback
    network,
  };
  cert.expiryAt = expiryAt;
  await cert.save();

  await CertificateEvent.create({
    certificateId: cert._id,
    type: 'issued',
    actor: { userId: issuedByUserId, role: 'regulator_admin' },
    details: { notes },
  });

  logger.info(`Certificate issued successfully certId=${cert._id}`);
  return { cert, tx };
}

/**
 * Validate a certificate on chain
 */
async function validateCertificate({ certificateId, validatorUserId }) {
  logger.info(`Validating certificate=${certificateId}`);

  const cert = await Certificate.findById(certificateId);
  if (!cert) throw new AppError('Certificate not found', 404);

  if (!cert.chain || !cert.chain.onChainId) {
    throw new AppError('Certificate not anchored on chain', 400);
  }

  const network = cert.chain.network || 'testnet';
  const receipt = await web3Service.validateCertificateOnChain({
    certificateId: cert.chain.onChainId,
    network,
  });

  await Web3Tx.create({
    network,
    purpose: 'validate',
    certificateId: cert._id,
    submittedByUserId: validatorUserId,
    txHash: receipt.txHash,
    status: receipt.success ? 'confirmed' : 'failed',
    responseDump: receipt,
  });

  if (receipt.success) {
    cert.status = 'validated';
    await cert.save();

    await CertificateEvent.create({
      certificateId: cert._id,
      type: 'validated',
      actor: { userId: validatorUserId, role: 'regulator_admin' },
      details: receipt,
    });

    logger.info(`Certificate validated certId=${cert._id}`);
  } else {
    logger.warn(`Certificate validation failed certId=${cert._id}`, { receipt });
  }

  return { success: receipt.success, receipt };
}

module.exports = {
  createCertificate,
  checkCertificateIssued,
  getAllCertificates,
  getCertificateById,
  updateCertificate,
  deleteCertificate,
  initContract,
  readDocument,
  isAddressWhitelisted,
  whitelistAddress,
  removeFromWhitelist,
  transferOwnership,
  ownerAddress: sorobanService.ownerAddress, // direct passthrough
  createWallet,
  fundWallet,
  validateCertificate,
  issueCertificate,
  getCertificate,
};
