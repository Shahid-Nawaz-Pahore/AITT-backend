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

// -------- CONFIG --------
const RPC_URL = process.env.RPC_URL;
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const CONTRACT_ID = process.env.CONTRACT_ID;
const OWNER_ADDRESS = process.env.OWNER_ADDRESS;
const SERVICE_SECRET = process.env.SERVICE_SECRET;

const serviceKP = Keypair.fromSecret(SERVICE_SECRET);
const server = new SorobanRpc.Server(RPC_URL);
const contract = new Contract(CONTRACT_ID);

// -------- HELPERS --------

function safeValue(val) {
  if (typeof val === 'bigint') return val.toString();
  if (Array.isArray(val)) return val.map(safeValue);
  if (val && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val).map(([k, v]) => [k, safeValue(v)])
    );
  }
  return val;
}

function makeScValAddress(pubKey) {
  logger.debug('Converting pubKey to ScVal address', { pubKey });
  const addr = new Address(pubKey);
  return nativeToScVal(addr);
}
function makeScValString(str) {
  return nativeToScVal(str, { type: 'string' });
}

// -------- CORE TX --------
async function sendTx(method, ...args) {
  try {
    logger.info('sendTx start', { method, argCount: args.length });

    const src = await server.getAccount(serviceKP.publicKey());

    let tx = new TransactionBuilder(src, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    tx = await server.prepareTransaction(tx);
    tx.sign(serviceKP);

    const sendResp = await server.sendTransaction(tx);
    if (sendResp.errorResult) {
      throw new AppError(500, 'Transaction failed', JSON.stringify(sendResp.errorResult));
    }

    let txResp = await server.getTransaction(sendResp.hash);
    while (txResp.status === 'NOT_FOUND') {
      await new Promise(r => setTimeout(r, 1000));
      txResp = await server.getTransaction(sendResp.hash);
    }

    logger.info('sendTx success', { method, hash: sendResp.hash, status: txResp.status });
    return {
      hash: sendResp.hash,
      status: txResp.status,
      ledger: txResp.ledger,
      feeCharged: txResp.feeCharged
    };
  } catch (err) {
    logger.error('sendTx failed', { method, error: err.message });
    throw err instanceof AppError ? err : new AppError(500, 'sendTx failed', err.message);
  }
}


async function fetchValue(method, ...args) {
  try {
    logger.info('fetchValue start', { method, args: args.map(a => a.toString()) });

    const src = await server.getAccount(serviceKP.publicKey());
    const tx = new TransactionBuilder(src, { 
      fee: BASE_FEE, 
      networkPassphrase: NETWORK_PASSPHRASE 
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const prep = await server.prepareTransaction(tx);
    const sim = await server.simulateTransaction(prep);

    if (!sim || sim.error || (sim.result && sim.result.err)) {
      throw new AppError(500, `Simulation failed for ${method}`, JSON.stringify(sim?.error ?? sim?.result));
    }

    // 🔹 log the raw retval first
    logger.debug('fetchValue raw retval', { retval: sim.result?.retval });

    // 🔹 convert retval safely
    let val = scValToNative(sim.result?.retval);
    val = safeValue(val);

    logger.info('fetchValue success', { method, value: val });

    return val ?? null;
  } catch (err) {
    logger.error('fetchValue failed', { method, error: err.message });
    throw err instanceof AppError ? err : new AppError(500, 'fetchValue failed', err.message);
  }
}


// ... existing imports and helpers

// -------- BUSINESS METHODS --------
async function storeDocument(name, hash) {
    logger.info('Storing document', { name, hash });
  return sendTx(
    'store_document',
    makeScValString(name),
    makeScValString(hash)
  );
}

async function verifyDocument(hash) {
  logger.info('Verifying document', { hash });

  const result = await fetchValue(
    'verify_document',
    makeScValString(hash)
  );

  logger.info('Verification raw result', { hash, result });

  return result;
}


async function initContract() {
    logger.info('Initializing contract', { owner: OWNER_ADDRESS });
  return sendTx(
    'init',
    makeScValAddress(OWNER_ADDRESS)
  );
}

module.exports = {
  makeScValAddress,
  makeScValString,
  sendTx,
  fetchValue,
  storeDocument,
  verifyDocument,
  initContract,
  OWNER_ADDRESS
};
