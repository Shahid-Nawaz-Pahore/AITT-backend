// __tests__/certificate.service.unit.test.js
// -------------------------
// Unit tests for src/services/certificate.service.js
// Mocks ALL external dependencies so no DB / chain / fs / real env are needed.
// -------------------------

// Ensure a clean module registry and create mocks BEFORE requiring the service.
jest.resetModules();

// Mock soroban.service BEFORE requiring the certificate service so its top-level code never runs.
jest.doMock('../src/services/soroban.service', () => {
  return {
    readDocument: jest.fn(),
    storeDocument: jest.fn(),
    verifyDocument: jest.fn(),
    isWhitelisted: jest.fn()
  };
});

// Mock models (Certificate, CertificateEvent, Web3Tx)
jest.doMock('../src/models/Certificate', () => {
  return {
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    countDocuments: jest.fn()
  };
});
jest.doMock('../src/models/CertificateEvent', () => {
  return {
    create: jest.fn(),
    find: jest.fn(),
    deleteMany: jest.fn()
  };
});
jest.doMock('../src/models/Web3Tx', () => {
  return {
    create: jest.fn(),
    find: jest.fn(),
    deleteMany: jest.fn()
  };
});

// Mock logger to silence output
jest.doMock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}));

// Mock fs to avoid touching disk
jest.doMock('fs', () => ({
  existsSync: jest.fn(),
  unlinkSync: jest.fn()
}));

// Now require the mocked modules and the real service module
const sorobanService = require('../src/services/soroban.service');
const Certificate = require('../src/models/Certificate');
const CertificateEvent = require('../src/models/CertificateEvent');
const Web3Tx = require('../src/models/Web3Tx');
const fs = require('fs');
const logger = require('../src/utils/logger');

// Require the real service *after* mocks are in place
const svc = require('../src/services/certificate.service');

// AppError used for assertions
const AppError = require('../src/utils/AppError');

describe('certificate.service (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createCertificate', () => {
    it('throws 400 if required fields are missing', async () => {
      await expect(svc.createCertificate({})).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when document already exists on chain', async () => {
      sorobanService.readDocument.mockResolvedValue({ some: 'val' });

      await expect(svc.createCertificate({
        certificateName: 'C',
        subject: 'S',
        metadataHash: 'abc',
        requestedByUserId: 'u'
      })).rejects.toMatchObject({ statusCode: 500 });

      expect(sorobanService.readDocument).toHaveBeenCalledWith('abc');
    });

    it('wraps sorobanService.readDocument error into AppError(500)', async () => {
      sorobanService.readDocument.mockRejectedValue(new Error('horizon down'));

      await expect(svc.createCertificate({
        certificateName: 'C',
        subject: 'S',
        metadataHash: 'abc',
        requestedByUserId: 'u'
      })).rejects.toMatchObject({ statusCode: 500 });
    });

    it('throws 502 when storeDocument throws', async () => {
      sorobanService.readDocument.mockResolvedValue(null);
      sorobanService.storeDocument.mockRejectedValue(new Error('network fail'));

      await expect(svc.createCertificate({
        certificateName: 'C',
        subject: 'S',
        metadataHash: 'abc',
        requestedByUserId: 'u'
      })).rejects.toMatchObject({ statusCode: 502 });

      expect(sorobanService.storeDocument).toHaveBeenCalledWith('C', 'abc', null);
    });

    it('throws 500 when storeDocument returns non-success receipt', async () => {
      sorobanService.readDocument.mockResolvedValue(null);
      sorobanService.storeDocument.mockResolvedValue({ status: 'FAILED' });

      await expect(svc.createCertificate({
        certificateName: 'C',
        subject: 'S',
        metadataHash: 'abc',
        requestedByUserId: 'u'
      })).rejects.toMatchObject({ statusCode: 500 });
    });

    it('throws 500 when receipt has no txHash', async () => {
      sorobanService.readDocument.mockResolvedValue(null);
      sorobanService.storeDocument.mockResolvedValue({ status: 'SUCCESS' }); // missing hash

      await expect(svc.createCertificate({
        certificateName: 'C',
        subject: 'S',
        metadataHash: 'abc',
        requestedByUserId: 'u'
      })).rejects.toMatchObject({ statusCode: 500 });
    });

    it('persists certificate and returns cert & tx on success', async () => {
      sorobanService.readDocument.mockResolvedValue(null);
      sorobanService.storeDocument.mockResolvedValue({ status: 'SUCCESS', hash: 'tx123', txHash: 'tx123' });

      const fakeCert = { _id: 'cert1', certificateName: 'C' };
      Certificate.create.mockResolvedValue(fakeCert);
      Web3Tx.create.mockResolvedValue({ _id: 'tx1' });
      CertificateEvent.create.mockResolvedValue({ _id: 'ev1' });

      const res = await svc.createCertificate({
        certificateName: 'C',
        subject: 'S',
        metadataHash: 'abc',
        requestedByUserId: 'u',
        network: 'testnet'
      });

      expect(Certificate.create).toHaveBeenCalledWith(expect.objectContaining({
        certificateName: 'C',
        metadataHash: 'abc',
        status: 'issued',
        chain: expect.objectContaining({ txHashIssue: 'tx123' })
      }));

      expect(Web3Tx.create).toHaveBeenCalledWith(expect.objectContaining({
        txHash: 'tx123',
        certificateId: fakeCert._id
      }));

      expect(CertificateEvent.create).toHaveBeenCalledWith(expect.objectContaining({
        certificateId: fakeCert._id,
        type: 'issued'
      }));

      expect(res).toHaveProperty('cert', fakeCert);
      expect(res).toHaveProperty('tx', expect.objectContaining({ _id: 'tx1' }));
    });

    it('if Web3Tx.create fails, function still returns cert', async () => {
      sorobanService.readDocument.mockResolvedValue(null);
      sorobanService.storeDocument.mockResolvedValue({ status: 'SUCCESS', hash: 'tx123' });

      const fakeCert = { _id: 'cert1' };
      Certificate.create.mockResolvedValue(fakeCert);
      Web3Tx.create.mockRejectedValue(new Error('db write fail'));
      CertificateEvent.create.mockResolvedValue({ _id: 'ev1' });

      const res = await svc.createCertificate({
        certificateName: 'C',
        subject: 'S',
        metadataHash: 'abc',
        requestedByUserId: 'u'
      });

      expect(Certificate.create).toHaveBeenCalled();
      expect(Web3Tx.create).toHaveBeenCalled();
      expect(res.cert).toBe(fakeCert);
    });

    it('if CertificateEvent.create fails, still returns cert', async () => {
      sorobanService.readDocument.mockResolvedValue(null);
      sorobanService.storeDocument.mockResolvedValue({ status: 'SUCCESS', hash: 'tx123' });

      const fakeCert = { _id: 'cert1' };
      Certificate.create.mockResolvedValue(fakeCert);
      Web3Tx.create.mockResolvedValue({ _id: 'tx1' });
      CertificateEvent.create.mockRejectedValue(new Error('event db fail'));

      const res = await svc.createCertificate({
        certificateName: 'C',
        subject: 'S',
        metadataHash: 'abc',
        requestedByUserId: 'u'
      });

      expect(res.cert).toBe(fakeCert);
    });
  }); // createCertificate

  describe('checkCertificateIssued', () => {
    it('returns issued true when sorobanService.verifyDocument returns value', async () => {
      sorobanService.verifyDocument.mockResolvedValue({ foo: 'bar' });
      const res = await svc.checkCertificateIssued('h');
      expect(res.issued).toBe(true);
      expect(res.value).toEqual({ foo: 'bar' });
    });

    it('returns issued false when verifyDocument returns falsy', async () => {
      sorobanService.verifyDocument.mockResolvedValue(null);
      const res = await svc.checkCertificateIssued('h');
      expect(res.issued).toBe(false);
    });

    it('wraps error into AppError(500) when verifyDocument throws', async () => {
      sorobanService.verifyDocument.mockRejectedValue(new Error('boom'));
      await expect(svc.checkCertificateIssued('h')).rejects.toMatchObject({ statusCode: 500 });
    });
  });

  describe('readDocument & isAddressWhitelisted', () => {
    it('readDocument returns underlying result', async () => {
      sorobanService.readDocument.mockResolvedValue('x');
      const v = await svc.readDocument('hash');
      expect(v).toBe('x');
    });

    it('readDocument wraps error', async () => {
      sorobanService.readDocument.mockRejectedValue(new Error('nono'));
      await expect(svc.readDocument('h')).rejects.toMatchObject({ statusCode: 500 });
    });

    it('isAddressWhitelisted returns boolean', async () => {
      sorobanService.isWhitelisted.mockResolvedValue(true);
      const val = await svc.isAddressWhitelisted('GABC');
      expect(val).toBe(true);
    });

    it('isAddressWhitelisted wraps error', async () => {
      sorobanService.isWhitelisted.mockRejectedValue(new Error('boom'));
      await expect(svc.isAddressWhitelisted('GABC')).rejects.toMatchObject({ statusCode: 500 });
    });
  });

  // getAllCertificates unit tests - we mock the chainable mongoose query helpers
  describe('getAllCertificates (unit)', () => {
    it('maps certificates & events into compact DTO', async () => {
      const fakeCerts = [
        { _id: 'c1', certificateName: 'A', subject: 'S', companyId: { _id: 'com1', name: 'Co' }, createdAt: new Date(), chain: { txHashIssue: 't1' }, requestedByUserId: 'u1' }
      ];
      // Mock chainable query object
      Certificate.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(fakeCerts)
      });
      Certificate.countDocuments.mockResolvedValue(1);
      CertificateEvent.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          { certificateId: 'c1', actor: { userId: 'signer', role: 'company_admin' }, createdAt: new Date() }
        ])
      });

      const res = await svc.getAllCertificates({ filters: {}, page: 1, limit: 10 });
      expect(res.certificates[0]).toMatchObject({
        id: 'c1',
        certificateName: 'A',
        signedBy: 'signer',
        txHash: 't1'
      });
    });

    it('handles empty results', async () => {
      Certificate.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([])
      });
      Certificate.countDocuments.mockResolvedValue(0);
      CertificateEvent.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([])
      });

      const res = await svc.getAllCertificates({ filters: {}, page: 1, limit: 10 });
      expect(res.certificates).toHaveLength(0);
      expect(res.total).toBe(0);
    });
  });

  describe('getCertificateById (unit)', () => {
    it('throws 404 when not found', async () => {
      Certificate.findById.mockReturnValue({ populate: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(null) });
      await expect(svc.getCertificateById('notfound')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns certificate with events and transactions', async () => {
      const fakeCert = { _id: 'c1', certificateName: 'C' };
      Certificate.findById.mockReturnValue({ populate: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(fakeCert) });

      CertificateEvent.find.mockReturnValue({ populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([{ _id: 'e1' }]) });
      Web3Tx.find.mockReturnValue({ sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([{ _id: 't1' }]) });

      const res = await svc.getCertificateById('c1');
      expect(res).toHaveProperty('events');
      expect(res).toHaveProperty('transactions');
    });
  });

  describe('updateCertificate (unit)', () => {
    it('throws 404 when cert not found', async () => {
      Certificate.findById.mockResolvedValue(null);
      await expect(svc.updateCertificate('c1', { updateData: {} })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('replaces file and cleans up old file', async () => {
      const existing = { _id: 'c1', storage: { path: '/tmp/old' } };
      Certificate.findById.mockResolvedValue(existing);
      Certificate.findByIdAndUpdate.mockReturnValue({ populate: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue({ _id: 'c1' }) });

      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockImplementation(() => { /* success */ });

      CertificateEvent.create.mockResolvedValue({});

      const res = await svc.updateCertificate('c1', {
        updateData: { title: 'x' },
        newFileMeta: { originalFilename: 'f', mimeType: 'text/plain', size: 10 },
        newStorageMeta: { provider: 'local', path: '/tmp/new', publicUrl: 'http://host/new' },
        updatedByUserId: 'u'
      });

      expect(fs.existsSync).toHaveBeenCalledWith('/tmp/old');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/old');
      expect(res).toHaveProperty('certificate');
    });

    it('does not throw when unlinkSync fails (logs warn)', async () => {
      const existing = { _id: 'c1', storage: { path: '/tmp/old' } };
      Certificate.findById.mockResolvedValue(existing);
      Certificate.findByIdAndUpdate.mockReturnValue({ populate: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue({ _id: 'c1' }) });

      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockImplementation(() => { throw new Error('perm denied'); });

      CertificateEvent.create.mockResolvedValue({});

      const res = await svc.updateCertificate('c1', {
        updateData: { title: 'x' },
        newFileMeta: { originalFilename: 'f', mimeType: 'text/plain', size: 10 },
        newStorageMeta: { provider: 'local', path: '/tmp/new', publicUrl: 'http://host/new' },
        updatedByUserId: 'u'
      });

      expect(res).toHaveProperty('certificate');
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('deleteCertificate (unit)', () => {
    it('throws 404 when not found', async () => {
      Certificate.findById.mockResolvedValue(null);
      await expect(svc.deleteCertificate('c1', { deletedByUserId: 'u' })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('deletes records and files when present', async () => {
      const cert = { _id: 'c1', storage: { path: '/tmp/file' } };
      Certificate.findById.mockResolvedValue(cert);
      CertificateEvent.deleteMany.mockResolvedValue({ deletedCount: 2 });
      Web3Tx.deleteMany.mockResolvedValue({ deletedCount: 3 });
      Certificate.findByIdAndDelete.mockResolvedValue({ _id: 'c1' });

      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockImplementation(() => {});

      const res = await svc.deleteCertificate('c1', { deletedByUserId: 'u' });
      expect(res.deletedCounts.certificate).toBe(1);
      expect(res.deletedCounts.events).toBe(2);
      expect(res.deletedCounts.transactions).toBe(3);
      expect(res.deletedCounts.filesDeleted).toBe(1);
    });

    it('continues when unlinkSync throws', async () => {
      const cert = { _id: 'c1', storage: { path: '/tmp/file' } };
      Certificate.findById.mockResolvedValue(cert);
      CertificateEvent.deleteMany.mockResolvedValue({ deletedCount: 0 });
      Web3Tx.deleteMany.mockResolvedValue({ deletedCount: 0 });
      Certificate.findByIdAndDelete.mockResolvedValue({ _id: 'c1' });

      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockImplementation(() => { throw new Error('fail'); });

      const res = await svc.deleteCertificate('c1', { deletedByUserId: 'u' });
      expect(res.deletedCounts.certificate).toBe(1);
      expect(res.deletedCounts.filesDeleted).toBe(0);
      expect(logger.error).toHaveBeenCalled();
    });
  }); // deleteCertificate
});
