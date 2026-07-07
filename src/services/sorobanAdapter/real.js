// src/services/sorobanAdapter/real.js
// ---------------------------------------------------------------------------
// Real adapter — wraps the DEPLOYED contract ABI exactly (NOT our local
// contract/lib.rs). Method names below match the on-chain contract
// CA6KYPPXEUTAP4X6JAEOI37OD2SCKEAUOSV2VN5ICDWCAI4WASFHRSYB.
//
// Custodial signing (A2): writes are signed by the service key by default; pass
// opts.signerSecret to sign as a specific named signer (e.g. a sub-admin for
// submit_review / approve_proposal). The contract's address PARAMS are always
// passed explicitly so they match whatever key signs.
//
// `action` for createProposal is the normalized form produced by index.js:
//   { type: 'RevokeCertificate', docHash }
//   { type: 'UpdateThreshold', value }
//   { type: 'ContractUpgrade', wasmHash }   (32-byte hex)
// `status` for submitReview is the contract DocumentStatus enum NAME
// ('Approved' | 'ApprovedWithRecommendations' | 'RequiresChanges' | 'Rejected').
// ---------------------------------------------------------------------------
const rpc = require('./rpc');
const AppError = require('../../utils/AppError');
const { ONCHAIN_ACTION_TYPES } = require('./stub');
const {
  decodeDocument,
  decodeVerifiedDocument,
  decodeReview,
  decodeProposal,
} = require('./decode');

const signerFromOpts = (o = {}) => (o.signerSecret ? rpc.Keypair.fromSecret(o.signerSecret) : null);

function actionToScVal(action) {
  if (!action || !ONCHAIN_ACTION_TYPES.includes(action.type)) {
    throw new AppError(400, `invalid on-chain proposal action: ${action && action.type}`);
  }
  switch (action.type) {
    case 'RevokeCertificate':
      return rpc.enumScVal('RevokeCertificate', rpc.stringScVal(action.docHash));
    case 'UpdateThreshold':
      return rpc.enumScVal('UpdateThreshold', rpc.u32ScVal(action.value));
    case 'ContractUpgrade':
      return rpc.enumScVal('ContractUpgrade', rpc.bytesN32ScVal(action.wasmHash));
    default:
      throw new AppError(400, `unknown proposal action: ${action.type}`);
  }
}

const realAdapter = {
  kind: 'real',

  // ---- Reads ----
  // Scalars (address/u32/bool) decode cleanly via scValToNative; structs +
  // enums + u64 are normalized through decode.js so every return is shaped
  // EXACTLY like the stub (see decode.js header).
  // The main admin IS the custodial service signer in this deployment, so return
  // the service key's own address instead of a chain read. The `main_admin_address`
  // simulate can fail to decode its Address return on some serverless/runtime + RPC
  // combinations ("fetchValue failed for main_admin_address"); this yields the same
  // value with no round-trip. Every write that needs the admin arg signs with this
  // same key, so it stays consistent by construction.
  mainAdminAddress: async () => rpc.getClients().serviceKP.publicKey(),
  governanceThreshold: async () => Number(await rpc.fetchValue('governance_threshold', [])),
  isSubAdmin: async (addr) => !!(await rpc.fetchValue('is_sub_admin_public', [rpc.addressScVal(addr)])),
  isWhitelisted: async (addr) => !!(await rpc.fetchValue('is_whitelisted', [rpc.addressScVal(addr)])),
  readDocument: async (hash) => decodeDocument(await rpc.fetchValue('read_document', [rpc.stringScVal(hash)])),
  verifyDocument: async (hash) => decodeVerifiedDocument(await rpc.fetchValue('verify_document', [rpc.stringScVal(hash)])),
  readReview: async (docHash, reviewer) =>
    decodeReview(await rpc.fetchValue('read_review', [rpc.stringScVal(docHash), rpc.addressScVal(reviewer)])),
  readProposal: async (id) => decodeProposal(await rpc.fetchValue('read_proposal', [rpc.u64ScVal(id)])),

  // ---- Writes ----
  init: (o = {}) =>
    rpc.sendTx('init', [rpc.addressScVal(o.mainAdmin || rpc.getConfig().OWNER_ADDRESS)], signerFromOpts(o)),

  addSubAdmin: (adminAddr, subAddr, o = {}) =>
    rpc.sendTx('add_sub_admin', [rpc.addressScVal(adminAddr), rpc.addressScVal(subAddr)], signerFromOpts(o)),

  removeSubAdmin: (adminAddr, subAddr, o = {}) =>
    rpc.sendTx('remove_sub_admin', [rpc.addressScVal(adminAddr), rpc.addressScVal(subAddr)], signerFromOpts(o)),

  setThreshold: (adminAddr, n, o = {}) =>
    rpc.sendTx('set_threshold', [rpc.addressScVal(adminAddr), rpc.u32ScVal(n)], signerFromOpts(o)),

  whitelistAddress: (addr, o = {}) =>
    rpc.sendTx('whitelist_address', [rpc.addressScVal(addr)], signerFromOpts(o)),

  removeFromWhitelist: (addr, o = {}) =>
    rpc.sendTx('remove_from_whitelist', [rpc.addressScVal(addr)], signerFromOpts(o)),

  storeDocument: (actorAddr, name, hash, o = {}) =>
    rpc.sendTx('store_document', [rpc.addressScVal(actorAddr), rpc.stringScVal(name), rpc.stringScVal(hash)], signerFromOpts(o)),

  issueCertificate: (adminAddr, docHash, expiry, o = {}) =>
    rpc.sendTx('issue_certificate', [rpc.addressScVal(adminAddr), rpc.stringScVal(docHash), rpc.u64ScVal(expiry)], signerFromOpts(o)),

  transferMainAdmin: (newAddr, o = {}) =>
    rpc.sendTx('transfer_main_admin', [rpc.addressScVal(newAddr)], signerFromOpts(o)),

  submitReview: (subAdminAddr, docHash, status, score, commentHash, o = {}) =>
    rpc.sendTx(
      'submit_review',
      [rpc.addressScVal(subAdminAddr), rpc.stringScVal(docHash), rpc.enumScVal(status), rpc.u32ScVal(score), rpc.stringScVal(commentHash)],
      signerFromOpts(o),
    ),

  async createProposal(proposerAddr, action, o = {}) {
    const receipt = await rpc.sendTx(
      'create_proposal',
      [rpc.addressScVal(proposerAddr), actionToScVal(action)],
      signerFromOpts(o),
    );
    // create_proposal returns the new u64 id.
    return { ...receipt, proposalId: receipt.returnValue != null ? Number(receipt.returnValue) : null };
  },

  approveProposal: (subAdminAddr, id, o = {}) =>
    rpc.sendTx('approve_proposal', [rpc.addressScVal(subAdminAddr), rpc.u64ScVal(id)], signerFromOpts(o)),
};

module.exports = { realAdapter, actionToScVal };
