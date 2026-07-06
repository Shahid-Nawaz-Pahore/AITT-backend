# Deployment & Go-Live Runbook

The code is production-ready (296 tests green, live suite 20/20 vs the deployed
contract, `npm audit --omit=dev` clean). The remaining go-live work is **deployment
configuration**. Do these in order.

---

## 1. Contract pointer — FIXED (was pointing at the wrong contract)

**Finding (verified on testnet, read-only):** the runtime `.env` was configured with
`CONTRACT_ID=CC4PAMOJ75KHHK75D7XGJ4FDLNE27L674W5CUNRKTH4BMGARXR6QMQU7`, but that is an
**incompatible older (v1) contract**. Probing it live:

| Method | `CA6KYPPX…` (validated v2) | `CC4PAMOJ…` (old v1) |
|--------|---------------------------|----------------------|
| `main_admin_address` | ✅ | ❌ `WasmVm, MissingValue` |
| `governance_threshold` | ✅ | ❌ missing |
| `is_sub_admin_public` | ✅ | ❌ missing |
| `read_proposal` | ✅ | ❌ missing |
| `is_whitelisted` / `read_document` / `verify_document` | ✅ | ✅ (v1 subset only) |

`CC4PAMOJ` is missing the entire governance / sub-admin / proposal ABI the backend
requires. In real mode against it, every review/issue/governance call fails.

**Action taken:** `.env` and `.env.githubActions` were repointed to the validated
`CA6KYPPX…` and `SERVICE_SECRET` / `OWNER_ADDRESS` aligned to that contract's main
admin (from `deployment-result.json`). All parity/live testing was done against
`CA6KYPPX…`. If you intend to deploy a *fresh* contract, deploy the WASM in
`../stellar_document_verification_system` (or `contract/`) and set `CONTRACT_ID` to the
new id, then re-run `npm run test:live` to re-validate before go-live.

---

## 2. Secrets — ROTATE (treat every secret in the old `.env` as COMPROMISED)

The prior `.env`/`.env.githubActions` contained live secrets in plaintext. They are
git-ignored (never committed) but were present in the working/deploy bundle and must
be considered leaked. Rotate ALL of them and load from a secret store (never a file
on disk in prod):

- [ ] **MongoDB Atlas** — rotate the DB user password (`ahsanfarooq531`), or create a
      new least-privilege user; update `MONGO_URI`.
- [ ] **`JWT_ACCESS_SECRET`** — generate a new 48-byte value
      (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
      Rotating it invalidates all existing access tokens (desired for a compromise).
- [ ] **`SERVICE_SECRET`** (Stellar main-admin key) — for a real deployment, use a
      dedicated prod key that is the main admin of your `CONTRACT_ID`. The fixture key
      currently in `.env` is a shared testnet key.
- [ ] **`KEY_ENCRYPTION_SECRET`** — set it (custodial keys are stored plaintext without
      it). If you already created wallets in dev without it, re-encrypt them with
      `utils/wallet.rotateKey` before go-live.
- [ ] Remove any secret from `docker-compose.yml` `env_file` bundling; inject via the
      orchestrator's secret mechanism instead.

`WHITELISTED_SIGNER_SECRET` was removed (dead — no longer referenced by any code).

---

## 3. Production posture — flip the mode

Copy `.env.production.example` → `.env` and fill every `<SET_ME>`. The key differences
from a dev `.env` (all enforced by the boot-time validator, `src/config/env.js`):

- [ ] `NODE_ENV=production`
- [ ] `SOROBAN_ADAPTER=real` (the app refuses to boot on the stub in prod — audit C2)
- [ ] `KEY_ENCRYPTION_SECRET` set, `ALLOW_PLAINTEXT_KEYS=false`
- [ ] `JWT_ACCESS_SECRET` ≥ 32 chars, `JWT_ACCESS_TTL=15m`
- [ ] `STORAGE_DRIVER=gridfs` (uploads survive multi-instance) and `ENABLE_SCHEDULER=true`
- [ ] `AUTO_FUND_WALLETS=false` on mainnet (friendbot is testnet-only)

## 4. Boot verification

```bash
npm start
curl -s localhost:4000/health        # -> {"status":"ok",...}
curl -s localhost:4000/ready         # -> 200 {"ready":true,"checks":{"mongo":"up","rpc":"up"},"adapter":"real"}
```
A `503` from `/ready` means Mongo or the Soroban RPC is unreachable — do not route
traffic until it is `200`. For multi-instance, front the app with the LB using `/ready`
and use a shared secret store (and a Redis-backed rate limiter — see below).

## 5. Multi-instance notes

- Uploads (GridFS), the scheduler (DB lease lock), and the durable outbox are all
  multi-instance safe.
- **Rate limiting is currently in-memory (per-instance).** For N instances the limits
  are effectively N×. Before scaling out, back `express-rate-limit` with a shared store
  (e.g. Redis) — the limiter definitions live in `src/middlewares/rateLimiters.js`.
