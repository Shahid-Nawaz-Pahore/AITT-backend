const sorobanService = require('../src/services/soroban.service');
const Certificate = require('../src/models/Certificate');
const CertificateEvent = require('../src/models/CertificateEvent');
const Web3Tx = require('../src/models/Web3Tx');
const fs = require('fs');
const AppError = require('../src/utils/AppError');
const logger = require('../src/utils/logger');

const {
  createCertificate,
  checkCertificateIssued,
  getAllCertificates,
  getCertificateById,
  updateCertificate,
  deleteCertificate,
  initContract,
  whitelistAddress
} = require('../src/services/certificate.service');

// ---- setup mocks ----
jest.mock('../src/services/soroban.service');
jest.mock('../src/models/Certificate');
jest.mock('../src/models/CertificateEvent');
jest.mock('../src/models/Web3Tx');
jest.mock('fs');
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createCertificate', () => {
  it('throws error if required fields missing', async () => {
    await expect(createCertificate({})).rejects.toThrow(AppError);
  });

  it('creates certificate on success', async () => {
    sorobanService.readDocument.mockResolvedValue(null);
    sorobanService.storeDocument.mockResolvedValue({ status: 'SUCCESS', hash: '0x123' });

    Certificate.create.mockResolvedValue({ _id: 'cert1' });
    Web3Tx.create.mockResolvedValue({});
    CertificateEvent.create.mockResolvedValue({});

    const result = await createCertificate({
      certificateName: 'Cert A',
      companyId: 'comp1',
      subject: 'Alice',
      metadataHash: 'abc123',
      requestedByUserId: 'user1'
    });

    expect(sorobanService.storeDocument).toHaveBeenCalled();
    expect(Certificate.create).toHaveBeenCalled();
    expect(result.cert._id).toBe('cert1');
  });

  it('throws if blockchain storeDocument fails', async () => {
    sorobanService.readDocument.mockResolvedValue(null);
    sorobanService.storeDocument.mockRejectedValue(new Error('boom'));

    await expect(createCertificate({
      certificateName: 'Cert A',
      companyId: 'comp1',
      subject: 'Alice',
      metadataHash: 'abc123',
      requestedByUserId: 'user1'
    })).rejects.toThrow(AppError);
  });
});

describe('checkCertificateIssued', () => {
  it('returns issued true when sorobanService returns value', async () => {
    sorobanService.verifyDocument.mockResolvedValue({ some: 'data' });
    const res = await checkCertificateIssued('abc');
    expect(res.issued).toBe(true);
  });
});

describe('getAllCertificates', () => {
  it('returns paginated certificates', async () => {
    Certificate.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ _id: 'cert1', certificateName: 'Cert A', subject: 'Alice', chain: { txHashIssue: '0x123' } }])
    });

    Certificate.countDocuments.mockResolvedValue(1);
    CertificateEvent.find.mockReturnValue({ sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) });

    const res = await getAllCertificates({});
    expect(res.certificates.length).toBe(1);
    expect(res.total).toBe(1);
  });
});

describe('updateCertificate', () => {
  it('updates cert and deletes old file if needed', async () => {
    Certificate.findById.mockResolvedValue({ _id: 'cert1', storage: { path: 'oldpath' } });
    Certificate.findByIdAndUpdate.mockResolvedValue({ _id: 'cert1', certificateName: 'Updated' });
    fs.existsSync.mockReturnValue(true);
    fs.unlinkSync.mockReturnValue();

    const res = await updateCertificate('cert1', {
      updateData: { certificateName: 'Updated' },
      newFileMeta: { originalFilename: 'file.pdf', mimeType: 'application/pdf', size: 123 },
      newStorageMeta: { provider: 'local', path: 'newpath', publicUrl: 'url' },
      updatedByUserId: 'user1'
    });

    expect(fs.unlinkSync).toHaveBeenCalled();
    expect(res.certificate.certificateName).toBe('Updated');
  });
});

describe('deleteCertificate', () => {
  it('deletes cert and cleans file', async () => {
    Certificate.findById.mockResolvedValue({ _id: 'cert1', storage: { path: 'file.pdf' } });
    CertificateEvent.deleteMany.mockResolvedValue({ deletedCount: 2 });
    Web3Tx.deleteMany.mockResolvedValue({ deletedCount: 1 });
    Certificate.findByIdAndDelete.mockResolvedValue({ _id: 'cert1' });
    fs.existsSync.mockReturnValue(true);

    const res = await deleteCertificate('cert1', { deletedByUserId: 'admin' });
    expect(res.deletedCounts.certificate).toBe(1);
  });
});

describe('initContract', () => {
  it('stores tx on success', async () => {
    sorobanService.initContract.mockResolvedValue({ status: 'SUCCESS', hash: '0xinit' });
    Web3Tx.create.mockResolvedValue({});
    const res = await initContract();
    expect(res.hash).toBe('0xinit');
  });
});

describe('whitelistAddress', () => {
  it('creates whitelist tx', async () => {
    sorobanService.whitelistAddress.mockResolvedValue({ status: 'SUCCESS', hash: '0xwhitelist' });
    Web3Tx.create.mockResolvedValue({});
    const res = await whitelistAddress('0xabc');
    expect(res.hash).toBe('0xwhitelist');
  });
});
