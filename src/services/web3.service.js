const logger = require('../utils/logger');

// NOTE: This is a stub. Replace with actual Soroban SDK calls.

async function issueCertificateOnChain({ certificateId, network, metadataHash }) {
  logger.info('Simulating on-chain issuance', { certificateId, network });
  // Simulate latency
  await new Promise((r) => setTimeout(r, 250));
  return { success: true, txHash: `0xsimulated-${Date.now()}`, onChainId: `chain-${certificateId}` };
}

async function validateCertificateOnChain({ certificateId, network }) {
  logger.info('Simulating on-chain validation', { certificateId, network });
  await new Promise((r) => setTimeout(r, 150));
  return { success: true, txHash: `0xsim-validate-${Date.now()}` };
}

module.exports = { issueCertificateOnChain, validateCertificateOnChain };
