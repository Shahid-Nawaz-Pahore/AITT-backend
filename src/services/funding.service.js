// src/services/funding.service.js
// ---------------------------------------------------------------------------
// Custodial wallet funding (B5 — the "unfunded-wallet gap"). A freshly generated
// custodial Stellar account does NOT exist on-chain until it is funded; its first
// self-signed tx (store_document / submit_review / approve_proposal) fails with
// "account not found". On testnet we fund via friendbot; this is wired into the
// admin-gated onboarding steps (company approval, sub-admin activation) so a
// brand-new company/officer wallet can transact.
//
// Gated by AUTO_FUND_WALLETS (default: on in dev, off in prod) and only acts in
// REAL adapter mode (stub mode has no chain). Best-effort by default: a funding
// hiccup never blocks account creation — it is retryable by ops.
//
// MAINNET SEAM (infra-owned TODO): friendbot is testnet-only. On mainnet, funding
// must originate from a treasury account (a CreateAccount/Payment op signed by a
// funded key). Implement mainnetFund(publicKey) and branch on NETWORK_PASSPHRASE;
// the call site (fundIfEnabled) does not change.
// ---------------------------------------------------------------------------
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { selectedAdapter } = require('../config/env');

const autoFundEnabled = () => String(process.env.AUTO_FUND_WALLETS).toLowerCase() === 'true';
const isMainnet = () => /public/i.test(String(process.env.NETWORK_PASSPHRASE || ''));

/**
 * fundWallet(publicKey) — fund an account via testnet friendbot. Idempotent-ish:
 * an "already funded" response is treated as success. Throws AppError on real
 * failures. Node 18+ global fetch (no node-fetch dep).
 */
async function fundWallet(publicKey) {
  if (!publicKey) throw new AppError(400, 'publicKey is required to fund a wallet');
  if (isMainnet()) {
    // Do not pretend to fund on mainnet — surface the seam explicitly.
    throw new AppError(501, 'Mainnet wallet funding is not configured (friendbot is testnet-only); implement the treasury funding seam');
  }
  if (typeof fetch !== 'function') {
    throw new AppError(500, 'global fetch unavailable (Node >= 18 required for friendbot funding)');
  }

  const base = (process.env.FRIENDBOT_URL || 'https://friendbot.stellar.org').replace(/\/$/, '');
  const url = `${base}/?addr=${encodeURIComponent(publicKey)}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const detail = JSON.stringify(body).slice(0, 200);
    if (/already.*fund|op_already_exists|already.?exist/i.test(detail)) {
      logger.info('friendbot: account already funded', { pub: publicKey.slice(0, 8) });
      return { funded: true, alreadyFunded: true };
    }
    throw new AppError(502, 'friendbot funding failed', detail);
  }
  logger.info('friendbot funded custodial wallet', { pub: publicKey.slice(0, 8) });
  return { funded: true };
}

/**
 * fundIfEnabled(publicKey) — the onboarding hook. Funds only when AUTO_FUND is on
 * AND the real adapter is selected (stub mode has no chain). Best-effort: logs
 * and returns a status object instead of throwing, so onboarding never fails on a
 * funding hiccup (the wallet can be funded later via POST /admin/wallets/fund).
 */
async function fundIfEnabled(publicKey) {
  if (!autoFundEnabled()) return { funded: false, skipped: 'auto-fund-disabled' };
  if (selectedAdapter() !== 'real') return { funded: false, skipped: 'stub-mode' };
  try {
    return await fundWallet(publicKey);
  } catch (err) {
    logger.warn('auto-fund failed (non-fatal — fund later via ops)', { pub: publicKey && publicKey.slice(0, 8), error: err.message });
    return { funded: false, error: err.message };
  }
}

module.exports = { fundWallet, fundIfEnabled, autoFundEnabled };
