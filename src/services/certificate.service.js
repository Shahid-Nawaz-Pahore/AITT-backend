// src/services/certificate.service.js
// ---------------------------------------------------------------------------
// Legacy certificate/admin surface. As of the production hardening (H3 #9) ALL
// chain access here goes through the sorobanAdapter (getAdapter) — the legacy
// soroban.service.js has been retired. The DB-only admin helpers (list / get /
// update / delete) are unchanged; the chain-touching helpers are thin wrappers
// over the adapter so `SOROBAN_ADAPTER=real` drives the real contract.
// ---------------------------------------------------------------------------
const Certificate = require('../models/Certificate');
const CertificateEvent = require('../models/CertificateEvent');
const Web3Tx = require('../models/Web3Tx');
const { Keypair } = require('@stellar/stellar-sdk');
const { getAdapter } = require('./sorobanAdapter');
const { txStatusFromReceipt } = require('./indexer.service');
const { generateWallet } = require('../utils/wallet');
const funding = require('./funding.service');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const fs = require('fs');

// A confirmed chain receipt across adapters: real => 'SUCCESS'; stub => 'simulated'.
const receiptOk = (r) => !!r && (r.status === 'SUCCESS' || r.status === 'simulated' || r.source === 'stub');
// The actor address for an adapter write: the signer's pubkey, else the service key's.
async function actorAddress(signerSecret, adapter) {
  if (signerSecret) return Keypair.fromSecret(signerSecret).publicKey();
  return adapter.mainAdminAddress();
}



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

  const adapter = getAdapter();

  // Check if document with same hash already exists on chain
  try {
    logger.info('Checking existing document on chain', { metadataHashShort: metadataHash.slice(0, 16) });
    const existing = await adapter.readDocument(metadataHash);
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
    // ---- Call the chain adapter (optionally with a specific signer) ----
    let receipt;
    try {
      const actor = await actorAddress(signerSecret, adapter);
      receipt = await adapter.storeDocument(actor, certificateName, metadataHash, { signerSecret });
    } catch (err) {
      logger.error('adapter.storeDocument threw an error', { error: err && err.message });
      throw new AppError(502, 'Blockchain store_document call failed', err && err.message);
    }

    if (!receiptOk(receipt)) {
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
    const value = await getAdapter().verifyDocument(hash);
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
    const receipt = await getAdapter().init({ signerSecret });

    if (!receiptOk(receipt)) {
      logger.error('initContract - blockchain call failed', { receipt });
      throw new AppError(500, 'Blockchain initContract failed');
    }

    // save tx audit
    await Web3Tx.create({
      network: 'testnet',
      purpose: 'init',
      txHash: receipt.hash,
      status: txStatusFromReceipt(receipt),
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
    const result = await getAdapter().readDocument(hash);
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
    const val = await getAdapter().isWhitelisted(address);
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
    const receipt = await getAdapter().whitelistAddress(address, { signerSecret });

    // save web3 tx - ensure Web3Tx enum supports 'whitelist'
    await Web3Tx.create({
      network: 'testnet',
      purpose: 'whitelist',
      txHash: receipt.hash,
      status: txStatusFromReceipt(receipt),
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
    const receipt = await getAdapter().removeFromWhitelist(address, { signerSecret });

    await Web3Tx.create({
      network: 'testnet',
      purpose: 'remove_whitelist',
      txHash: receipt.hash,
      status: txStatusFromReceipt(receipt),
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
  logger.info('transferMainAdmin start', { newOwnerShort: newOwner?.slice?.(0,8) ?? null });
  try {
    const receipt = await getAdapter().transferMainAdmin(newOwner, { signerSecret });

    await Web3Tx.create({
      network: 'testnet',
      purpose: 'transfer',
      txHash: receipt.hash,
      status: txStatusFromReceipt(receipt),
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
    const { publicKey, secret } = generateWallet();
    logger.info('createWallet', { pubShort: publicKey?.slice?.(0,8) ?? null });
    return { public_key: publicKey, secret };
  } catch (err) {
    logger.error('createWallet failed', { error: err.message });
    throw err instanceof AppError ? err : new AppError(500, 'createWallet failed', err.message);
  }
}

async function fundWallet(publicKey) {
  try {
    const result = await funding.fundWallet(publicKey);
    logger.info('fundWallet success', { pubShort: publicKey?.slice?.(0,8) ?? null });
    return result;
  } catch (err) {
    logger.error('fundWallet failed', { error: err.message });
    throw err instanceof AppError ? err : new AppError(500, 'fundWallet failed', err.message);
  }
}

/** ownerAddress — main admin address (was a legacy passthrough). */
async function ownerAddress() {
  return getAdapter().mainAdminAddress();
}

/* ---------------- Exports ---------------- */





/**
 * Fetch certificate with company populated
 */
async function getCertificate(id) {
  const cert = await Certificate.findById(id).populate('companyId');
  if (!cert) throw new AppError(404, 'Certificate not found'); // (was arg-swapped → crashed the error handler)
  return cert;
}

// ---------------------------------------------------------------------------
// NOTE (P1 / BE-C1): the previous `issueCertificate()` and `validateCertificate()`
// were removed. They referenced an undefined `web3Service` (a guaranteed
// ReferenceError) and `validateCertificate` set the stray `validated` status
// that no longer exists in the lifecycle. The proper review-gated issue flow
// (POST /documents/:id/issue -> issue_certificate) is (re)built in P3 behind the
// sorobanAdapter, enforcing the Approved/ApprovedWithRecommendations gate (gap #2).
// ---------------------------------------------------------------------------

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
  ownerAddress,
  createWallet,
  fundWallet,
  getCertificate,
};
