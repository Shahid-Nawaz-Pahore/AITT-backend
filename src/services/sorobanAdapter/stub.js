// src/services/sorobanAdapter/stub.js
// ---------------------------------------------------------------------------
// In-memory stub of the DEPLOYED contract
// (CA6KYPPXEUTAP4X6JAEOI37OD2SCKEAUOSV2VN5ICDWCAI4WASFHRSYB). It mirrors the
// on-chain rules faithfully so the rest of the backend can be built + tested
// without a live chain (the brief: "Ship against the stub").
//
// Faithful behaviors (matching lib.rs):
//   - store_document: duplicate hash panics ("Document already registered");
//     actor must be main admin or whitelisted.
//   - issue_certificate: main-admin only; only from Submitted; NO review gate
//     (the backend enforces the Approved/ApprovedWithRecommendations gate).
//   - submit_review: sub-admin only; overwrites per reviewer; NO 0–100 check.
//   - verify_document: effective status (Issued & past expiry => Expired);
//     verified == effective Issued.
//   - create_proposal: main-admin or sub-admin; starts with 0 approvals.
//   - approve_proposal: sub-admin only; double-approve guarded; auto-executes
//     at threshold. Only the 3 on-chain actions exist (RevokeCertificate,
//     UpdateThreshold, ContractUpgrade) — framework_update is NOT on-chain.
//
// Custodial model (A2): write methods are signed by the service key, which is
// the main admin, so main-admin-gated writes succeed by default. An explicit
// `opts.as` address can override the acting signer (used to exercise auth).
// ---------------------------------------------------------------------------
const AppError = require('../../utils/AppError');

const ONCHAIN_ACTION_TYPES = ['RevokeCertificate', 'UpdateThreshold', 'ContractUpgrade'];
const DEFAULT_MAIN_ADMIN = 'GSTUBADMIN000000000000000000000000000000000000000000000';

function createStubAdapter(opts = {}) {
  const state = {
    mainAdmin: opts.mainAdmin || process.env.OWNER_ADDRESS || DEFAULT_MAIN_ADMIN,
    threshold: opts.threshold ?? 1,
    whitelist: new Set(opts.whitelist || []),
    subAdmins: new Set(opts.subAdmins || []),
    documents: new Map(),                  // hash -> Document
    reviews: new Map(),                    // `${hash}|${reviewer}` -> Review
    proposals: new Map(),                  // id(number) -> Proposal
    proposalCount: 0,
    txCounter: 0,
  };

  // Injectable clock (unix seconds) for deterministic expiry tests.
  const nowSecs = opts.now || (() => Math.floor(Date.now() / 1000));
  // The custodial signer's address (defaults to main admin).
  const serviceAddress = () => opts.serviceAddress || state.mainAdmin;

  function receipt(method, extra = {}) {
    state.txCounter += 1;
    return {
      hash: `stub-${method}-${state.txCounter}`,
      status: 'simulated',
      ledger: state.txCounter,
      source: 'stub',
      latencyMs: 0,
      ...extra,
    };
  }

  const signerOf = (o = {}) => o.as || serviceAddress();

  function requireMainAdmin(actor, msg) {
    if (actor !== state.mainAdmin) throw new AppError(403, msg);
  }
  function requireSubAdmin(actor, msg) {
    if (!state.subAdmins.has(actor)) throw new AppError(403, msg);
  }

  function effectiveStatus(doc) {
    if (doc.status === 'Issued' && nowSecs() > Number(doc.expiry)) return 'Expired';
    return doc.status;
  }

  function executeAction(action) {
    switch (action.type) {
      case 'RevokeCertificate': {
        const doc = state.documents.get(action.docHash);
        if (!doc) throw new AppError(404, 'document not found');
        doc.status = 'Revoked';
        break;
      }
      case 'UpdateThreshold':
        state.threshold = Number(action.value);
        break;
      case 'ContractUpgrade':
        // no observable state change in the stub
        break;
      default:
        throw new AppError(400, `unknown proposal action: ${action.type}`);
    }
  }

  return {
    kind: 'stub',
    _state: state, // exposed for tests / reconcile inspection

    // ---- Reads ----
    async mainAdminAddress() { return state.mainAdmin; },
    async governanceThreshold() { return state.threshold; },
    async isSubAdmin(addr) { return state.subAdmins.has(addr); },
    async isWhitelisted(addr) { return state.whitelist.has(addr); },

    async readDocument(hash) {
      const doc = state.documents.get(hash);
      return doc ? { ...doc } : null;
    },

    async verifyDocument(hash) {
      const doc = state.documents.get(hash);
      if (!doc) return null;
      const certificate_status = effectiveStatus(doc);
      return {
        name: doc.name,
        hash: doc.hash,
        timestamp: doc.timestamp,
        added_by: doc.added_by,
        verified_document: certificate_status === 'Issued',
        certificate_status,
        expiry: doc.expiry,
      };
    },

    async readReview(docHash, reviewer) {
      const r = state.reviews.get(`${docHash}|${reviewer}`);
      return r ? { ...r } : null;
    },

    async readProposal(id) {
      const p = state.proposals.get(Number(id));
      return p ? { ...p, approvals: [...p.approvals] } : null;
    },

    // ---- Writes ----
    async init(o = {}) {
      state.mainAdmin = o.mainAdmin || serviceAddress();
      state.threshold = 1;
      return receipt('init');
    },

    async addSubAdmin(adminAddr, subAddr, o = {}) {
      requireMainAdmin(adminAddr, 'only main admin can manage sub-admins');
      state.subAdmins.add(subAddr);
      return receipt('add_sub_admin');
    },

    async removeSubAdmin(adminAddr, subAddr, o = {}) {
      requireMainAdmin(adminAddr, 'only main admin can manage sub-admins');
      state.subAdmins.delete(subAddr);
      return receipt('remove_sub_admin');
    },

    async setThreshold(adminAddr, n, o = {}) {
      requireMainAdmin(adminAddr, 'only main admin can set threshold');
      state.threshold = Number(n);
      return receipt('set_threshold');
    },

    async whitelistAddress(addr, o = {}) {
      requireMainAdmin(signerOf(o), 'not authorized: only main admin');
      state.whitelist.add(addr);
      return receipt('whitelist_address');
    },

    async removeFromWhitelist(addr, o = {}) {
      requireMainAdmin(signerOf(o), 'not authorized: only main admin');
      state.whitelist.delete(addr);
      return receipt('remove_from_whitelist');
    },

    async storeDocument(actorAddr, name, hash, o = {}) {
      if (state.documents.has(hash)) throw new AppError(409, 'Document already registered');
      if (actorAddr !== state.mainAdmin && !state.whitelist.has(actorAddr)) {
        throw new AppError(403, 'not authorized: only main admin or whitelisted address');
      }
      state.documents.set(hash, {
        name,
        hash,
        timestamp: nowSecs(),
        added_by: actorAddr,
        status: 'Submitted',
        expiry: 0,
      });
      return receipt('store_document');
    },

    async issueCertificate(adminAddr, docHash, expiry, o = {}) {
      requireMainAdmin(adminAddr, 'only main admin can issue certificates');
      const doc = state.documents.get(docHash);
      if (!doc) throw new AppError(404, 'document not found');
      if (doc.status !== 'Submitted') {
        throw new AppError(400, 'certificate can only be issued from Submitted status');
      }
      doc.status = 'Issued';
      doc.expiry = Number(expiry);
      return receipt('issue_certificate');
    },

    async transferMainAdmin(newAddr, o = {}) {
      const current = signerOf(o);
      requireMainAdmin(current, 'only main admin can transfer');
      if (newAddr === current) throw new AppError(400, 'new admin must be different');
      state.mainAdmin = newAddr;
      return receipt('transfer_main_admin');
    },

    async submitReview(subAdminAddr, docHash, status, score, commentHash, o = {}) {
      requireSubAdmin(subAdminAddr, 'not authorized: only sub-admins can submit reviews');
      state.reviews.set(`${docHash}|${subAdminAddr}`, {
        reviewer: subAdminAddr,
        status,
        score: Number(score),
        comment_hash: commentHash,
        timestamp: nowSecs(),
      });
      return receipt('submit_review');
    },

    async createProposal(proposerAddr, action, o = {}) {
      if (proposerAddr !== state.mainAdmin && !state.subAdmins.has(proposerAddr)) {
        throw new AppError(403, 'only main admin or sub-admin can create proposals');
      }
      if (!action || !ONCHAIN_ACTION_TYPES.includes(action.type)) {
        throw new AppError(400, `invalid on-chain proposal action: ${action && action.type}`);
      }
      state.proposalCount += 1;
      const id = state.proposalCount;
      state.proposals.set(id, { id, action: { ...action }, approvals: [], executed: false });
      return receipt('create_proposal', { proposalId: id, returnValue: id });
    },

    async approveProposal(subAdminAddr, id, o = {}) {
      requireSubAdmin(subAdminAddr, 'only sub-admins can approve proposals');
      const proposal = state.proposals.get(Number(id));
      if (!proposal) throw new AppError(404, 'proposal not found');
      if (proposal.executed) throw new AppError(409, 'proposal already executed');
      if (proposal.approvals.includes(subAdminAddr)) {
        throw new AppError(409, 'already approved by this sub-admin');
      }
      proposal.approvals.push(subAdminAddr);
      if (proposal.approvals.length >= state.threshold) {
        executeAction(proposal.action);
        proposal.executed = true;
      }
      return receipt('approve_proposal', { executed: proposal.executed });
    },
  };
}

module.exports = { createStubAdapter, ONCHAIN_ACTION_TYPES };
