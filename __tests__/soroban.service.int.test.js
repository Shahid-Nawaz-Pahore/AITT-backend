// top of file
require('dotenv').config();

// then your existing const RPC_URL = process.env.RPC_URL ...

// __tests__/soroban.service.readonly.int.test.js
// Read-only integration tests for Soroban service

const sorobanService = require('../src/services/soroban.service');
const { Keypair } = require('@stellar/stellar-sdk');

// Test constants - replace with actual values from your testnet
const TEST_CONSTANTS = {
  // Known document hash that exists on testnet (replace with actual)
  EXISTING_DOCUMENT_HASH: 'test-hash-that-exists-on-chain',
  
  // Known document hash that doesn't exist
  NON_EXISTENT_HASH: 'non-existent-hash-12345',
  
  // Known whitelisted address (replace with actual)
  WHITELISTED_ADDRESS: 'GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO',
  
  // Known non-whitelisted address
  NON_WHITELISTED_ADDRESS: 'GBXGQJWVLWOZMV7K3QIL2O7Q2ZJTQ5C2KPG2UQNQD5V2J34L5M6N7O8',
  
  // Expected owner address from your contract
  EXPECTED_OWNER_ADDRESS: process.env.OWNER_ADDRESS || 'GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVY2JO',
  
  // Test signer secret for read operations (can be any funded testnet account)
  TEST_SIGNER_SECRET: process.env.SERVICE_SECRET
};

describe('Soroban Service - Read-Only Integration Tests', () => {
  // Skip all tests if required environment variables are not set
  const requiredEnvVars = ['RPC_URL', 'CONTRACT_ID', 'SERVICE_SECRET'];
  const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
  
  beforeAll(() => {
    if (missingEnvVars.length > 0) {
      console.warn(`Skipping Soroban integration tests - missing env vars: ${missingEnvVars.join(', ')}`);
    }
  });

  describe('readDocument', () => {
    it('should return null for non-existent document', async () => {
      if (missingEnvVars.length > 0) {
        pending('Missing required environment variables');
        return;
      }

      const result = await sorobanService.readDocument(TEST_CONSTANTS.NON_EXISTENT_HASH);
      expect(result).toBeNull();
    }, 30000);

    it('should handle invalid hash format gracefully', async () => {
      if (missingEnvVars.length > 0) {
        pending('Missing required environment variables');
        return;
      }

      // This should not throw an error, but return null or handle gracefully
      const result = await sorobanService.readDocument('');
      expect(result).toBeNull();
    }, 30000);

    // Uncomment and update when you have a known existing document
    /*
    it('should return document data for existing hash', async () => {
      if (missingEnvVars.length > 0) {
        pending('Missing required environment variables');
        return;
      }

      const result = await sorobanService.readDocument(TEST_CONSTANTS.EXISTING_DOCUMENT_HASH);
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('actor');
    }, 30000);
    */
  });

  describe('verifyDocument', () => {
    it('should return null/false for non-existent document', async () => {
      if (missingEnvVars.length > 0) {
        pending('Missing required environment variables');
        return;
      }

      const result = await sorobanService.verifyDocument(TEST_CONSTANTS.NON_EXISTENT_HASH);
      expect(result).toBeFalsy();
    }, 30000);

    it('should work with custom signer secret', async () => {
      if (missingEnvVars.length > 0) {
        pending('Missing required environment variables');
        return;
      }

      const result = await sorobanService.verifyDocument(
        TEST_CONSTANTS.NON_EXISTENT_HASH, 
        TEST_CONSTANTS.TEST_SIGNER_SECRET
      );
      expect(result).toBeFalsy();
    }, 30000);

    // Uncomment when you have a known existing document
    /*
    it('should return truthy value for existing document', async () => {
      if (missingEnvVars.length > 0) {
        pending('Missing required environment variables');
        return;
      }

      const result = await sorobanService.verifyDocument(TEST_CONSTANTS.EXISTING_DOCUMENT_HASH);
      expect(result).toBeTruthy();
    }, 30000);
    */
  });

  describe('isWhitelisted', () => {
    it('should return boolean for any address', async () => {
      if (missingEnvVars.length > 0) {
        pending('Missing required environment variables');
        return;
      }

      const result = await sorobanService.isWhitelisted(TEST_CONSTANTS.NON_WHITELISTED_ADDRESS);
      expect(typeof result).toBe('boolean');
    }, 30000);

    it('should handle owner address', async () => {
      if (missingEnvVars.length > 0) {
        pending('Missing required environment variables');
        return;
      }

      const result = await sorobanService.isWhitelisted(TEST_CONSTANTS.EXPECTED_OWNER_ADDRESS);
      expect(typeof result).toBe('boolean');
      // Owner might or might not be whitelisted depending on contract logic
    }, 30000);

    it('should handle service account address', async () => {
      if (missingEnvVars.length > 0) {
        pending('Missing required environment variables');
        return;
      }

      const serviceKP = Keypair.fromSecret(TEST_CONSTANTS.TEST_SIGNER_SECRET);
      const result = await sorobanService.isWhitelisted(serviceKP.publicKey());
      expect(typeof result).toBe('boolean');
    }, 30000);

    // Uncomment when you have a known whitelisted address
    /*
    it('should return true for whitelisted address', async () => {
      if (missingEnvVars.length > 0) {
        pending('Missing required environment variables');
        return;
      }

      const result = await sorobanService.isWhitelisted(TEST_CONSTANTS.WHITELISTED_ADDRESS);
      expect(result).toBe(true);
    }, 30000);
    */
  });

  describe('ownerAddress', () => {
    it('should return the contract owner address', async () => {
      if (missingEnvVars.length > 0) {
        pending('Missing required environment variables');
        return;
      }

      const result = await sorobanService.ownerAddress();
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(result).toMatch(/^G[A-Z0-9]{55}$/); // Stellar address format
    }, 30000);

    it('should return consistent owner address across calls', async () => {
      if (missingEnvVars.length > 0) {
        pending('Missing required environment variables');
        return;
      }

      const result1 = await sorobanService.ownerAddress();
      const result2 = await sorobanService.ownerAddress();
      expect(result1).toBe(result2);
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      if (missingEnvVars.length > 0) {
        pending('Missing required environment variables');
        return;
      }

      // Test with malformed input that might cause network issues
      try {
        await sorobanService.readDocument(null);
      } catch (error) {
        expect(error.message).toBeTruthy();
      }
    }, 30000);

    it('should handle invalid address format in isWhitelisted', async () => {
      if (missingEnvVars.length > 0) {
        pending('Missing required environment variables');
        return;
      }

      try {
        await sorobanService.isWhitelisted('invalid-address');
      } catch (error) {
        expect(error.message).toContain('invalid');
      }
    }, 30000);
  });

  describe('Helper Functions', () => {
    describe('createWallet', () => {
      it('should create valid wallet keypair', () => {
        const wallet = sorobanService.createWallet();
        
        expect(wallet).toHaveProperty('public_key');
        expect(wallet).toHaveProperty('secret');
        expect(wallet.public_key).toMatch(/^G[A-Z0-9]{55}$/);
        expect(wallet.secret).toMatch(/^S[A-Z0-9]{55}$/);
        
        // Verify the keypair is valid
        const kp = Keypair.fromSecret(wallet.secret);
        expect(kp.publicKey()).toBe(wallet.public_key);
      });

      it('should create unique wallets', () => {
        const wallet1 = sorobanService.createWallet();
        const wallet2 = sorobanService.createWallet();
        
        expect(wallet1.public_key).not.toBe(wallet2.public_key);
        expect(wallet1.secret).not.toBe(wallet2.secret);
      });
    });

    // Note: fundWallet test is commented out as it actually funds accounts
    // Uncomment only if you want to test this (it will consume testnet XLM)
    /*
    describe('fundWallet', () => {
      it('should fund a testnet wallet', async () => {
        if (missingEnvVars.length > 0) {
          pending('Missing required environment variables');
          return;
        }

        const wallet = sorobanService.createWallet();
        const result = await sorobanService.fundWallet(wallet.public_key);
        
        expect(result).toHaveProperty('funded');
        expect(result.funded).toBe(true);
      }, 60000);
    });
    */
  });

  describe('Contract State Validation', () => {
    it('should verify contract is initialized', async () => {
      if (missingEnvVars.length > 0) {
        pending('Missing required environment variables');
        return;
      }

      // If owner address returns successfully, contract is likely initialized
      const owner = await sorobanService.ownerAddress();
      expect(owner).toBeTruthy();
    }, 30000);

    it('should have expected owner if set in environment', async () => {
      if (missingEnvVars.length > 0 || !TEST_CONSTANTS.EXPECTED_OWNER_ADDRESS) {
        pending('Missing required environment variables or expected owner not set');
        return;
      }

      const actualOwner = await sorobanService.ownerAddress();
      expect(actualOwner).toBe(TEST_CONSTANTS.EXPECTED_OWNER_ADDRESS);
    }, 30000);
  });

  describe('Service Account Validation', () => {
    it('should have valid service account configuration', () => {
      if (missingEnvVars.length > 0) {
        pending('Missing required environment variables');
        return;
      }

      // Verify service secret is valid
      const serviceKP = Keypair.fromSecret(TEST_CONSTANTS.TEST_SIGNER_SECRET);
      expect(serviceKP.publicKey()).toMatch(/^G[A-Z0-9]{55}$/);
    });
  });
});

// Test data setup helper (run this manually to set up test data)
describe.skip('Test Data Setup', () => {
  // These tests are skipped by default - run them manually to set up test data
  
  it('setup: store a test document for read tests', async () => {
    // Uncomment and run this once to create test data
    /*
    const testDoc = {
      name: 'Test Certificate for Integration Tests',
      hash: 'integration-test-hash-' + Date.now()
    };
    
    const result = await sorobanService.storeDocument(testDoc.name, testDoc.hash);
    console.log('Stored test document:', { hash: testDoc.hash, txHash: result.hash });
    console.log('Update TEST_CONSTANTS.EXISTING_DOCUMENT_HASH with:', testDoc.hash);
    */
  });
  
  it('setup: whitelist a test address', async () => {
    // Uncomment and run this once to create test data
    /*
    const testWallet = sorobanService.createWallet();
    await sorobanService.fundWallet(testWallet.public_key);
    
    const result = await sorobanService.whitelistAddress(testWallet.public_key);
    console.log('Whitelisted test address:', { address: testWallet.public_key, txHash: result.hash });
    console.log('Update TEST_CONSTANTS.WHITELISTED_ADDRESS with:', testWallet.public_key);
    */
  });
});