// __tests__/live/_liveEnv.js
// ---------------------------------------------------------------------------
// Shared harness for the GATED live suite (build brief: "a separate gated
// suite that runs only with SOROBAN_ADAPTER=real + creds + network").
//
// `liveDescribe` is `describe` only when SOROBAN_ADAPTER=real; otherwise it is
// `describe.skip`, so the default stub `npm test` collects these files but runs
// nothing live (CI stays green without creds/network). Run them with:
//     npm run test:live
//
// Creds are sourced from the deployed-contract fixtures (testnet-only) rather
// than duplicated into a committed .env:
//   deployment-result.json -> CONTRACT_ID, RPC_URL, SERVICE_SECRET (main admin)
//   test-accounts.json     -> wallet-01..wallet-10 keypairs (by id + role)
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const CONTRACT_DIR = path.join(__dirname, '../../../stellar_document_verification_system');
const deployment = JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, 'deployment-result.json'), 'utf8'));
const accounts = JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, 'test-accounts.json'), 'utf8'));

// --- Env (defaults from fixtures; respect anything already exported) ---
process.env.RPC_URL = process.env.RPC_URL || deployment.rpcUrl || 'https://soroban-testnet.stellar.org';
process.env.NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';
process.env.CONTRACT_ID = process.env.CONTRACT_ID || deployment.contractId;
process.env.SERVICE_SECRET = process.env.SERVICE_SECRET || deployment.mainAdmin.secretKey;
process.env.OWNER_ADDRESS = process.env.OWNER_ADDRESS || deployment.mainAdmin.publicKey;
process.env.FRIENDBOT_URL = process.env.FRIENDBOT_URL || 'https://friendbot.stellar.org';

const LIVE = (process.env.SOROBAN_ADAPTER || '').toLowerCase() === 'real';
const liveDescribe = LIVE ? describe : describe.skip;

// Reset the lazily-memoized rpc config/clients so the env set above applies even
// if rpc.js was required earlier in the process.
function resetRpc() {
  // eslint-disable-next-line global-require
  require('../../src/services/sorobanAdapter/rpc')._resetForTest();
}

// --- Wallet lookup ---
const byId = Object.fromEntries(accounts.map((w) => [w.id, w]));
// Roles per the deployed-contract README.
const wallets = {
  mainAdmin: byId['wallet-01'],
  subAdminA: byId['wallet-02'],
  subAdminB: byId['wallet-03'],
  subAdminC: byId['wallet-10'],
  companyA: byId['wallet-04'],
  companyB: byId['wallet-05'],
  stranger: byId['wallet-06'],
};
const pub = (w) => w.publicKey;
const sec = (w) => w.secretKey;

// A unique 64-hex doc hash per test run (avoids "Document already registered").
let _ctr = 0;
function freshHash(tag = '') {
  _ctr += 1;
  const stamp = `${Date.now().toString(16)}${_ctr.toString(16)}${tag}`;
  return (stamp + '0'.repeat(64)).slice(0, 64);
}

// Bound the per-tx confirmation wait a touch tighter for tests.
process.env.SOROBAN_TX_TIMEOUT_MS = process.env.SOROBAN_TX_TIMEOUT_MS || '90000';

module.exports = {
  LIVE,
  liveDescribe,
  resetRpc,
  deployment,
  accounts,
  wallets,
  pub,
  sec,
  freshHash,
};
