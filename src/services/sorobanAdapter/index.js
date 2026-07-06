// src/services/sorobanAdapter/index.js
// ---------------------------------------------------------------------------
// sorobanAdapter — the single seam for ALL chain access (build brief hard
// constraint). Selects the in-memory `stub` or the live `real` impl via env:
//
//     SOROBAN_ADAPTER = 'stub' (default) | 'real'
//     USE_SOROBAN_STUB = 'true'|'false'  (alternative toggle)
//
// We ship against the stub; the real impl wraps the deployed contract and can
// be switched on with SOROBAN_ADAPTER=real once creds are present.
//
// Both impls expose the SAME interface (READ_METHODS + WRITE_METHODS below).
// Proposal types are mapped to on-chain actions here; `framework_update` is
// rejected at this boundary because it is governed entirely in the backend
// (gap #1) and has NO on-chain ProposalAction.
// ---------------------------------------------------------------------------
const { createStubAdapter, ONCHAIN_ACTION_TYPES } = require('./stub');
const { realAdapter } = require('./real');
const { decisionToContract } = require('../../utils/statusMap');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');

const READ_METHODS = [
  'mainAdminAddress', 'governanceThreshold', 'isSubAdmin', 'isWhitelisted',
  'readDocument', 'verifyDocument', 'readReview', 'readProposal',
];
const WRITE_METHODS = [
  'init', 'addSubAdmin', 'removeSubAdmin', 'setThreshold', 'whitelistAddress',
  'removeFromWhitelist', 'storeDocument', 'issueCertificate', 'transferMainAdmin',
  'submitReview', 'createProposal', 'approveProposal',
];
const INTERFACE_METHODS = [...READ_METHODS, ...WRITE_METHODS];

// frontend ProposalType -> on-chain ProposalAction (or off-chain marker).
const PROPOSAL_TYPE_TO_ACTION = {
  revocation: 'RevokeCertificate',
  governance_rule: 'UpdateThreshold',
  contract_upgrade: 'ContractUpgrade',
  framework_update: null, // OFF-CHAIN (backend-only) — never hits the adapter
};

function isOnChainProposalType(type) {
  return !!PROPOSAL_TYPE_TO_ACTION[type];
}

/**
 * mapProposalAction(type, payload) — translate a frontend proposal type +
 * payload into the normalized on-chain action the adapter expects. Throws for
 * framework_update (off-chain) and unknown types.
 *   revocation       -> { type:'RevokeCertificate', docHash }
 *   governance_rule  -> { type:'UpdateThreshold', value }
 *   contract_upgrade -> { type:'ContractUpgrade', wasmHash }
 */
function mapProposalAction(type, payload = {}) {
  const action = PROPOSAL_TYPE_TO_ACTION[type];
  if (action === null) {
    throw new AppError(400, `Proposal type '${type}' is governed off-chain (backend-only); it must not be sent to the chain adapter`);
  }
  if (!action) throw new AppError(400, `Unknown proposal type: ${type}`);
  switch (action) {
    case 'RevokeCertificate':
      return { type: action, docHash: payload.docHash ?? payload.metadataHash };
    case 'UpdateThreshold':
      return { type: action, value: Number(payload.value ?? payload.threshold) };
    case 'ContractUpgrade':
      return { type: action, wasmHash: payload.wasmHash };
    default:
      throw new AppError(400, `Unmapped proposal action: ${action}`);
  }
}

// Convenience: translate a frontend ReviewDecision to the contract status name
// for submitReview (e.g. 'approved_with_recommendations' -> 'ApprovedWithRecommendations').
function reviewDecisionToContract(decision) {
  const name = decisionToContract(decision);
  if (!name) throw new AppError(400, `Invalid review decision: ${decision}`);
  return name;
}

// ---------------------------------------------------------------------------
// Selection (memoized; fresh stub available for tests)
// ---------------------------------------------------------------------------
let _singleton = null;

function selectMode() {
  const explicit = (process.env.SOROBAN_ADAPTER || '').toLowerCase();
  if (explicit === 'real') return 'real';
  if (explicit === 'stub') return 'stub';
  if (String(process.env.USE_SOROBAN_STUB).toLowerCase() === 'false') return 'real';
  return 'stub'; // default: ship against the stub
}

function buildAdapter() {
  const mode = selectMode();
  if (mode === 'real') {
    logger.info('sorobanAdapter: using REAL adapter (deployed contract)');
    return realAdapter;
  }
  // Loud warning outside tests (audit C3): the stub SIMULATES the blockchain —
  // writes are recorded as confirmed but nothing is anchored on-chain.
  if (String(process.env.NODE_ENV).toLowerCase() !== 'test') {
    logger.warn('sorobanAdapter: using STUB adapter — the blockchain is SIMULATED (no on-chain anchoring). Set SOROBAN_ADAPTER=real for real writes.');
  } else {
    logger.info('sorobanAdapter: using STUB adapter (in-memory)');
  }
  return createStubAdapter();
}

/** getAdapter({ fresh }) — the selected adapter; { fresh:true } rebuilds it. */
function getAdapter(opts = {}) {
  if (opts.fresh) {
    _singleton = buildAdapter();
    return _singleton;
  }
  if (!_singleton) _singleton = buildAdapter();
  return _singleton;
}

module.exports = {
  getAdapter,
  buildAdapter,
  createStubAdapter,
  realAdapter,
  // interface + helpers
  READ_METHODS,
  WRITE_METHODS,
  INTERFACE_METHODS,
  ONCHAIN_ACTION_TYPES,
  PROPOSAL_TYPE_TO_ACTION,
  isOnChainProposalType,
  mapProposalAction,
  reviewDecisionToContract,
};
