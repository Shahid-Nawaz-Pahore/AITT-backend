// src/services/soroban.service.js
const {
  rpc: SorobanRpc,
  Keypair,
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  scValToNative,
  nativeToScVal,
  Address
} = require('@stellar/stellar-sdk');

const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

// config from .env
const RPC_URL = process.env.RPC_URL;
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const CONTRACT_ID = process.env.CONTRACT_ID;
const OWNER_ADDRESS = process.env.OWNER_ADDRESS;
const SERVICE_SECRET = process.env.SERVICE_SECRET;
const FRIENDBOT_URL = process.env.FRIENDBOT_URL || 'https://friendbot.stellar.org';

if (!RPC_URL) throw new Error('RPC_URL must be set in .env');
if (!CONTRACT_ID) throw new Error('CONTRACT_ID must be set in .env');
if (!SERVICE_SECRET) throw new Error('SERVICE_SECRET must be set in .env');

const serviceKP = Keypair.fromSecret(SERVICE_SECRET);
const server = new SorobanRpc.Server(RPC_URL);
const contract = new Contract(CONTRACT_ID);

/* ---------------- Helpers ---------------- */

function safeValue(val) {
  if (typeof val === 'bigint') return val.toString();
  if (Buffer.isBuffer(val)) return val.toString('hex');
  if (Array.isArray(val)) return val.map(safeValue);
  if (val && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val).map(([k, v]) => [k, safeValue(v)])
    );
  }
  return val;
}

function makeScValAddress(pubKey) {
  logger.debug('makeScValAddress', { shortPub: pubKey?.slice?.(0, 8) ?? null });
  const addr = new Address(pubKey);
  return nativeToScVal(addr);
}
function makeScValString(str) {
  logger.debug('makeScValString', { len: str?.length ?? 0, prefix: (str || '').slice(0,16) });
  return nativeToScVal(str, { type: 'string' });
}

/* ---------------- Core RPC wrappers ---------------- */

/**
 * sendTx(method, args = [], signerKP = serviceKP)
 * - method: contract method name
 * - args: array of SCVal args (already created via makeScVal*)
 * - signerKP: Keypair (optional) to sign with; defaults to serviceKP
 */
async function sendTx(method, args = [], signerKP = serviceKP) {
  try {
    const signerPubShort = signerKP.publicKey().slice(0,8);
    logger.info('sendTx start', { method, argCount: args.length, signer: signerPubShort });

    // load account of signer
    const src = await server.getAccount(signerKP.publicKey());

    let tx = new TransactionBuilder(src, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    tx = await server.prepareTransaction(tx);

    // simulate
    const sim = await server.simulateTransaction(tx);
    const simErr = sim?.error ?? sim?.result?.err;
    const diagCount = sim?.result?.diagnostic_events ? sim.result.diagnostic_events.length : 0;
    logger.info('sendTx simulation', { method, diagCount, simulated: !!sim, simErr: !!simErr });

    if (!sim || simErr) {
      throw new AppError(500, 'Simulation failed', JSON.stringify(simErr ?? sim ?? {}));
    }

    // sign with provided signer
    tx.sign(signerKP);

    // send
    const sendResp = await server.sendTransaction(tx);
    if (sendResp.errorResult) {
      logger.error('sendTx sendTransaction returned errorResult', { method, errorSnippet: JSON.stringify(sendResp.errorResult).slice(0,200) });
      throw new AppError(500, 'Transaction failed', JSON.stringify(sendResp.errorResult));
    }

    // wait confirmation
    let txResp = await server.getTransaction(sendResp.hash);
    while (txResp.status === 'NOT_FOUND') {
      await new Promise(r => setTimeout(r, 1000));
      txResp = await server.getTransaction(sendResp.hash);
    }

    logger.info('sendTx success', { method, hash: sendResp.hash, status: txResp.status, ledger: txResp.ledger });
    return { hash: sendResp.hash, status: txResp.status, ledger: txResp.ledger, feeCharged: txResp.feeCharged };
  } catch (err) {
    logger.error('sendTx failed', { method, message: err?.message?.slice?.(0,200) ?? String(err) });
    throw err instanceof AppError ? err : new AppError(500, 'sendTx failed', err.message ?? String(err));
  }
}

/**
 * fetchValue(method, args = [], signerKP = serviceKP)
 * - read-only: you can optionally provide signerKP but defaults to serviceKP.
 */
async function fetchValue(method, args = [], signerKP = serviceKP) {
  try {
    logger.info('fetchValue start', { method, argCount: args.length });

    const src = await server.getAccount(signerKP.publicKey());
    const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const prep = await server.prepareTransaction(tx);
    const sim = await server.simulateTransaction(prep);

    const simErr = sim?.error ?? sim?.result?.err;
    logger.info('fetchValue simulation', { method, simulated: !!sim, simErr: !!simErr });

    if (!sim || simErr) {
      throw new AppError(500, `Simulation failed for ${method}`, JSON.stringify(simErr ?? sim ?? {}));
    }

    try {
      logger.debug('fetchValue raw retval', { method, shortRetval: JSON.stringify(sim.result?.retval).slice(0,300) });
    } catch (e) {
      logger.debug('fetchValue raw retval could not stringify');
    }

    let val = scValToNative(sim.result?.retval);
    val = safeValue(val);

    logger.info('fetchValue success', { method, hasValue: val !== null });
    return val ?? null;
  } catch (err) {
    logger.error('fetchValue failed', { method, message: err?.message?.slice?.(0,200) ?? String(err) });
    throw err instanceof AppError ? err : new AppError(500, 'fetchValue failed', err.message ?? String(err));
  }
}

/* --------------- Business-level functions (now accept optional signer secret) --------------- */

/**
 * storeDocument(name, hash, signerSecret = null)
 * If signerSecret provided: sign with Keypair.fromSecret(signerSecret) (and use that pubKey as actor).
 * Otherwise sign with serviceKP (owner key).
 */
async function storeDocument(name, hash, signerSecret = null) {
  try {
    const signerKP = signerSecret ? Keypair.fromSecret(signerSecret) : serviceKP;
    const actorPub = signerKP.publicKey();

    logger.info('storeDocument start', { namePrefix: (name||'').slice(0,16), hashShort: (hash||'').slice(0,16), actorShort: actorPub.slice(0,8) });

    const actorSc = makeScValAddress(actorPub);
    const nameSc = makeScValString(name);
    const hashSc = makeScValString(hash);

    // pass args as array and signerKP to sendTx
    const receipt = await sendTx('store_document', [actorSc, nameSc, hashSc], signerKP);

    logger.info('storeDocument success', { namePrefix: (name||'').slice(0,16), txHash: receipt.hash });
    return receipt;
  } catch (err) {
    logger.error('storeDocument failed', { message: err.message?.slice?.(0,200) ?? String(err) });
    throw err instanceof AppError ? err : new AppError(500, 'storeDocument failed', err.message ?? String(err));
  }
}

/**
 * verifyDocument(hash) - read-only
 */
async function verifyDocument(hash, signerSecret = null) {
  try {
    const signerKP = signerSecret ? Keypair.fromSecret(signerSecret) : serviceKP;
    logger.info('verifyDocument start', { hashShort: (hash||'').slice(0,16) });

    const result = await fetchValue('verify_document', [ makeScValString(hash) ], signerKP);

    logger.info('verifyDocument result', { hashShort: (hash||'').slice(0,16), hasValue: result !== null });
    return result;
  } catch (err) {
    logger.error('verifyDocument failed', { message: err.message?.slice?.(0,200) ?? String(err) });
    throw err instanceof AppError ? err : new AppError(500, 'verifyDocument failed', err.message ?? String(err));
  }
}

/**
 * readDocument(hash)
 */
async function readDocument(hash) {
  try {
    logger.info('readDocument start', { hashShort: (hash||'').slice(0,16) });
    const result = await fetchValue('read_document', [ makeScValString(hash) ]);
    logger.info('readDocument result', { hashShort: (hash||'').slice(0,16), exists: result !== null });
    return result;
  } catch (err) {
    logger.error('readDocument failed', { message: err.message?.slice?.(0,200) ?? String(err) });
    throw err instanceof AppError ? err : new AppError(500, 'readDocument failed', err.message ?? String(err));
  }
}

/* Whitelist and owner ops (accept optional signerSecret but default to serviceKP) */

async function isWhitelisted(address) {
  try {
    logger.info('isWhitelisted start', { addressShort: address?.slice?.(0,8) ?? null });
    const value = await fetchValue('is_whitelisted', [ makeScValAddress(address) ]);
    return !!value;
  } catch (err) {
    logger.error('isWhitelisted failed', { message: err.message?.slice?.(0,200) ?? String(err) });
    throw err instanceof AppError ? err : new AppError(500, 'isWhitelisted failed', err.message ?? String(err));
  }
}

async function whitelistAddress(address, signerSecret = null) {
  try {
    const signerKP = signerSecret ? Keypair.fromSecret(signerSecret) : serviceKP;
    logger.info('whitelistAddress start', { addressShort: address?.slice?.(0,8) ?? null, signerShort: signerKP.publicKey().slice(0,8) });
    const addrSc = makeScValAddress(address);
    const receipt = await sendTx('whitelist_address', [ addrSc ], signerKP);
    logger.info('whitelistAddress success', { txHash: receipt.hash });
    return receipt;
  } catch (err) {
    logger.error('whitelistAddress failed', { message: err.message?.slice?.(0,200) ?? String(err) });
    throw err instanceof AppError ? err : new AppError(500, 'whitelistAddress failed', err.message ?? String(err));
  }
}

async function removeFromWhitelist(address, signerSecret = null) {
  try {
    const signerKP = signerSecret ? Keypair.fromSecret(signerSecret) : serviceKP;
    logger.info('removeFromWhitelist start', { addressShort: address?.slice?.(0,8) ?? null, signerShort: signerKP.publicKey().slice(0,8) });
    const addrSc = makeScValAddress(address);
    const receipt = await sendTx('remove_from_whitelist', [ addrSc ], signerKP);
    logger.info('removeFromWhitelist success', { txHash: receipt.hash });
    return receipt;
  } catch (err) {
    logger.error('removeFromWhitelist failed', { message: err.message?.slice?.(0,200) ?? String(err) });
    throw err instanceof AppError ? err : new AppError(500, 'removeFromWhitelist failed', err.message ?? String(err));
  }
}

async function ownerAddress() {
  try {
    logger.info('ownerAddress start');
    const value = await fetchValue('owner_address', []);
    return value;
  } catch (err) {
    logger.error('ownerAddress failed', { message: err.message?.slice?.(0,200) ?? String(err) });
    throw err instanceof AppError ? err : new AppError(500, 'ownerAddress failed', err.message ?? String(err));
  }
}

async function transferOwnership(newOwner, signerSecret = null) {
  try {
    const signerKP = signerSecret ? Keypair.fromSecret(signerSecret) : serviceKP;
    logger.info('transferOwnership start', { newOwnerShort: newOwner?.slice?.(0,8) ?? null, signerShort: signerKP.publicKey().slice(0,8) });
    const sc = makeScValAddress(newOwner);
    const receipt = await sendTx('transfer_ownership', [ sc ], signerKP);
    logger.info('transferOwnership success', { txHash: receipt.hash });
    return receipt;
  } catch (err) {
    logger.error('transferOwnership failed', { message: err.message?.slice?.(0,200) ?? String(err) });
    throw err instanceof AppError ? err : new AppError(500, 'transferOwnership failed', err.message ?? String(err));
  }
}

/* Wallet / friendbot helpers */

function createWallet() {
  try {
    const kp = Keypair.random();
    logger.info('createWallet', { pubShort: kp.publicKey().slice(0,8) });
    return { public_key: kp.publicKey(), secret: kp.secret() };
  } catch (err) {
    logger.error('createWallet failed', { message: err.message?.slice?.(0,200) ?? String(err) });
    throw new AppError(500, 'createWallet failed', err.message ?? String(err));
  }
}

async function fundWallet(publicKey) {
  let fetchFn = null;
  if (typeof fetch !== 'undefined') fetchFn = fetch;
  else {
    try {
      fetchFn = require('node-fetch');
    } catch (e) {
      fetchFn = null;
    }
  }

  if (!fetchFn) {
    throw new AppError(500, 'fundWallet failed', 'fetch not available; install node-fetch or use Node >=18');
  }

  try {
    logger.info('fundWallet start', { publicShort: publicKey?.slice?.(0,8) ?? null });
    const fbUrl = `${FRIENDBOT_URL}/?addr=${encodeURIComponent(publicKey)}`;
    const resp = await fetchFn(fbUrl);
    const body = await (async () => {
      try { return await resp.json(); } catch (e) { return await resp.text(); }
    })();

    if (!resp.ok) {
      logger.error('fundWallet friendbot failed', { publicShort: publicKey?.slice?.(0,8), status: resp.status });
      throw new AppError(500, 'friendbot failed', JSON.stringify(body).slice(0,200));
    }

    logger.info('fundWallet success', { publicShort: publicKey?.slice?.(0,8) ?? null });
    return { funded: true, friendbot: body };
  } catch (err) {
    logger.error('fundWallet failed', { message: err.message?.slice?.(0,200) ?? String(err) });
    throw err instanceof AppError ? err : new AppError(500, 'fundWallet failed', err.message ?? String(err));
  }
}

async function initContract(signerSecret = null) {
  try {
    const signerKP = signerSecret ? Keypair.fromSecret(signerSecret) : serviceKP;
    logger.info('initContract start', { ownerShort: OWNER_ADDRESS?.slice?.(0,8) ?? null, signerShort: signerKP.publicKey().slice(0,8) });
    const receipt = await sendTx('init', [ makeScValAddress(OWNER_ADDRESS) ], signerKP);
    logger.info('initContract success', { txHash: receipt.hash });
    return receipt;
  } catch (err) {
    logger.error('initContract failed', { message: err.message?.slice?.(0,200) ?? String(err) });
    throw err instanceof AppError ? err : new AppError(500, 'initContract failed', err.message ?? String(err));
  }
}

module.exports = {
  makeScValAddress,
  makeScValString,
  sendTx,
  fetchValue,
  storeDocument,
  verifyDocument,
  readDocument,
  isWhitelisted,
  whitelistAddress,
  removeFromWhitelist,
  ownerAddress,
  transferOwnership,
  createWallet,
  fundWallet,
  initContract,
  OWNER_ADDRESS: OWNER_ADDRESS || null
};
