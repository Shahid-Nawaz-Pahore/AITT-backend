# API Endpoints (MVP)

## Security hardening (Phase H1)
- **No public file serving.** The `express.static('/certificates')` mount was removed (audit #1); files are served ONLY via the authed, role-scoped `GET /api/v1/documents/:id/file`.
- **`POST /auth/register` is super_admin-only** (audit C1). Bootstrap the first admin out-of-band: `SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… node src/migrations/seed-admin.js`.
- **`GET /certificates/admin/all` is super_admin-only** + page-size capped (audit C3).
- **Rate limiting:** strict per-route limiter on `/auth/login` (failed-attempt counted) + `/auth/refresh` + `/auth/exchange-key`; per-account lockout after `LOGIN_LOCKOUT_THRESHOLD` failures.
- **NoSQL injection:** `express-mongo-sanitize` strips `$`/`.` keys globally; list filters (`status`/`type`) are coerced against known enums; regex search input is escaped (audit #8).
- **Dependencies:** `npm audit` = 0 critical / 0 high (3 moderate remain in the dev-only `mongodb-memory-server`).

## Auth
- POST /api/v1/auth/register  (**super_admin only** — create users)
- POST /api/v1/auth/login  (rate-limited; account lockout)
- POST /api/v1/auth/refresh  (rate-limited)
- POST /api/v1/auth/exchange-key  (rate-limited; keeps API keys in DB, not used by main routes)

## Certificates
- POST /api/v1/certificates          (company_admin)
- GET  /api/v1/certificates/:id      (company_admin | regulator_admin | public-read)
- ~~POST /api/v1/certificates/:id/issue~~ — REMOVED in P1 (BE-C1): the handler called an undefined `web3Service`. The review-gated issue flow is rebuilt in P3 as `POST /api/v1/documents/:id/issue` (enforces the Approved / ApprovedWithRecommendations gate before `issue_certificate`).
- ~~POST /api/v1/certificates/:id/validate~~ — REMOVED in P1 (BE-C1): the deployed contract has no separate "validate" step; `verify` covers public verification.
- GET  /api/v1/certificates/:id/verify   (public)


All responses use the envelope: `{ success: boolean, data: object|null, message?: string }`.

## P2 — Chain adapter, indexer & reconcile (internal services)

P2 adds NO new HTTP endpoints. It introduces the internal seam that all chain
access goes through, so P3/P4 endpoints can be wired on top.

### `services/sorobanAdapter` — the single chain seam
Two interchangeable implementations behind one interface, selected by env:

| env | values | effect |
|-----|--------|--------|
| `SOROBAN_ADAPTER` | `stub` (default) \| `real` | choose in-memory stub or live deployed contract |
| `USE_SOROBAN_STUB` | `true` \| `false` | alternative toggle (`false` ⇒ real) |
| `SOROBAN_TX_TIMEOUT_MS` | number (default `60000`) | hard deadline for tx confirmation (fixes the old unbounded `NOT_FOUND` loop) |
| `SOROBAN_TX_POLL_INTERVAL_MS` | number (default `1000`) | initial confirmation poll interval |
| `SOROBAN_TX_POLL_MAX_MS` | number (default `5000`) | back-off cap |

Interface (wraps the DEPLOYED ABI `CA6KYPP…`):
- **Reads:** `mainAdminAddress`, `governanceThreshold`, `isSubAdmin`, `isWhitelisted`, `readDocument`, `verifyDocument`, `readReview`, `readProposal`
- **Writes (custodial / A2):** `init`, `addSubAdmin`, `removeSubAdmin`, `setThreshold`, `whitelistAddress`, `removeFromWhitelist`, `storeDocument`, `issueCertificate`, `transferMainAdmin`, `submitReview`, `createProposal`, `approveProposal`
- **Proposal mapping:** `revocation→RevokeCertificate`, `governance_rule→UpdateThreshold`, `contract_upgrade→ContractUpgrade`. **`framework_update` is rejected at the adapter boundary** — it is governed off-chain in the DB (gap #1).

### `services/indexer.service` — write-through (custodial mirror)
After each successful adapter write: `recordTx()` persists a `Web3Tx` audit row and `mirror*()` projects the new state onto Mongo (composed 9-status + latest-wins `complianceScore` + per-step `chain.txHash*`). `writeThrough()` ties call→record→mirror together.

### `services/reconcile.service` — chain↔DB drift
`reconcileCertificate(hash,{fix})`, `reconcileAllCertificates({fix})`, `reconcileGovernance({fix})`. Chain is the source of truth; `{ fix:true }` repairs the DB, otherwise drift is only reported.

### `migrations/migrate-p1.js`
`node src/migrations/migrate-p1.js [--dry-run] [--no-roles]` — company→active backfill, `regulator_admin→sub_admin`, legacy cert-status migrate (idempotent).

## P3 — Document lifecycle & onboarding

Responses match `frontend-aitt/src/mock/types.ts` (`DocItem` / `Company` / `SubAdmin`). Lists use `{ success, data, pagination:{ currentPage, totalPages, total, limit } }`.

### Documents (`/api/v1/documents`) — `DocItem`
- `POST /documents` (company_admin | super_admin) — multipart `file` + `subject` [+ `filename`]. **Re-hashes the file server-side**, anchors `store_document`. Company must be approved (whitelisted).
- `GET /documents` (any auth) — role-scoped (company sees own) + paginated list.
- `GET /documents/:id` (any auth) — detail (company can only see its own).
- `POST /documents/:id/review` (sub_admin | super_admin) — `{ decision, complianceScore (0–100), comment }`. Enforces gap #3 (0–100), #6 (one per officer), #4 (overall latest-wins); anchors `submit_review`.
- `POST /documents/:id/issue` (super_admin) — `{ expiryAt? }` (default +1yr). Enforces gap #2 (latest review must be Approved/ApprovedWithRecommendations); anchors `issue_certificate`.
- `GET /documents/:id/verify` · `GET /documents/verify/:hash` (public) — `verify_document`.

### Companies (`/api/v1/companies`)
- `POST /companies/register` (public) — `{ name, email, password?, wallet? }` → PENDING company + custodial wallet + `company_admin` login.
- `POST /companies/:id/approve` (super_admin) — `whitelist_address` → `active`.
- `DELETE /companies/:id` (super_admin).
- `GET /companies` (auth) — serialized + paginated (with `documents` count). `GET /companies/:id`, `GET /companies/with-users`.

### Sub-admins (`/api/v1/sub-admins`)
- `POST /sub-admins` (super_admin) — invite `{ name, email, password?, wallet? }` → INVITED + custodial wallet + `sub_admin` login.
- `POST /sub-admins/:id/activate` (super_admin) — `add_sub_admin` → `active` (can now review/approve).
- `GET /sub-admins` (auth) — serialized + paginated. `DELETE /sub-admins/:id` (super_admin) — `remove_sub_admin` + delete.

### Security (P3)
- `POST /soroban/store_document` is **no longer public** — admin-only raw passthrough. Documents are anchored only through the review-gated `/documents` flow.
- Custodial keys (A2, one per officer/company): Stellar secret AES-256-GCM encrypted at rest via `KEY_ENCRYPTION_SECRET`; never serialized to clients (`select:false`).

## P4 — Multi-sig governance

### Proposals (`/api/v1/proposals`) — `Proposal`
- `POST /proposals` (main admin | sub-admin) — `{ type, title, description?, targetRef?, payload? }`. **Creating ≠ signing**: on-chain proposals are created with **0 approvals** — the proposer (if a sub-admin) must also `sign` to approve (mirrors the deployed contract).
  - `revocation` → `RevokeCertificate` (`targetRef` = document id) · `governance_rule` → `UpdateThreshold` (`payload.value`) · `contract_upgrade` → `ContractUpgrade` (`payload.wasmHash`).
  - **`framework_update` → OFF-CHAIN (gap #1)** — no chain tx. `payload.action` ∈ create|update|deactivate|activate (+`name`/`description`/`frameworkId`); applied to the Framework collection when approvals ≥ threshold.
- `POST /proposals/:id/sign` (sub-admins) — `approve_proposal` on-chain (auto-executes at threshold) or off-chain tally for framework_update. **`signers` are read back from the on-chain `approvals[]` (gap #5)**; `approvals` = `signers.length`.
- `POST /proposals/:id/reject` (admin) — backend-only `rejected` (the contract has no reject).
- `GET /proposals` · `GET /proposals/:id` — serialized + paginated. `status` = executed ? `executed` : (rejected ? `rejected` : `pending`).

### Governance (`/api/v1/governance`)
- `GET /governance` → `{ required (N), total (M), signerWallets }` (M = active sub-admins).
- `PUT /governance` (admin) — `{ required, total? }`, enforces 1 ≤ N ≤ M, syncs the on-chain threshold via `set_threshold`. (Changing N via multi-sig instead uses a `governance_rule` proposal.)

## P5 — Extras & hardening

### Frameworks (`/api/v1/frameworks`) — READ-ONLY (decision A)
- `GET /frameworks` · `GET /frameworks/:id` (any auth). **Writes go ONLY through `framework_update` governance proposals** — no direct CRUD.

### Templates (`/api/v1/templates`)
- `GET /templates` · `GET /templates/:id` · `GET /templates/:id/download` (any auth) — download streams a `.docx` (stored file or a generated blank, dependency-free).
- `POST /templates` · `PUT /templates/:id` · `DELETE /templates/:id` (admin) — direct CRUD (blank downloads, not a §3 concern).

### Alerts (`/api/v1/alerts`)
- `GET /alerts` (monitors) — unresolved by default (`?includeResolved=true`). `POST /alerts` (admin) · `POST /alerts/:id/resolve` (monitors).

### Notifications (`/api/v1/notifications`)
- `GET /notifications` (current user; `?unreadOnly=true`) → list + `unread` count. `POST /notifications/:id/read` · `POST /notifications/read-all`.

### Documents (P5 addition)
- `GET /documents/:id/file` (role-scoped) — download the stored upload (disk-storage mode).

### Admin / ops (`/api/v1/admin`)
- `POST /admin/jobs/expiry` (admin) — run the expiry job (issued→expired + critical/warning alerts + notifications).
- `POST /admin/jobs/outbox` (admin) — drain the durable chain→DB mirror outbox.
- `POST /admin/jobs/reconcile` (admin) — reconcile chain↔DB (chain is source of truth; `{ fix:false }` to report-only).
- `GET /admin/audit` (admin) — request-level audit trail (paginated; includes auth **failures**, see H4).

### Hardening
- Global **audit middleware** records every successful mutating request (`AuditLog`).
- **Expiry job** transitions `issued→expired` + raises alerts/notifications; idempotent.
- `wallet.js` **hard-fails in production** without `KEY_ENCRYPTION_SECRET`.
- Seed defaults: `node src/migrations/seed-p5.js` (frameworks + templates, idempotent).

## Production hardening (H2–H4 + Epic I) — remediation

All chain access goes through the **sorobanAdapter** — see `docs/soroban-adapter-spec.md`.

### A. Startup safety & config (`src/config/env.js`)
- **Fail-fast validation** at boot (`server.js`): every required var is checked and safe
  defaults applied; on any problem the process logs the FULL list and `exit(1)` — never limps
  on bad config. Zero new deps (hand-rolled, fully auditable — a deliberate supply-chain choice
  over a heavyweight schema lib).
- **Production guards (audit C2):** in `NODE_ENV=production` the app **refuses to boot** if
  `SOROBAN_ADAPTER≠real` (no silent fake chain), or if `JWT_ACCESS_SECRET` / `KEY_ENCRYPTION_SECRET`
  are unset/too-short, or if the real adapter is missing `RPC_URL`/`CONTRACT_ID`/`SERVICE_SECRET`.
- **Key versioning (H2 #3):** custodial ciphertext is now `gcm:v1:…` (legacy `gcm:…` still
  decrypts); `wallet.rotateKey(stored,{oldSecret,newSecret})` is the rotation seam; `getDataKey()`
  is the single KMS integration boundary (TODO: swap for AWS/GCP KMS/Vault — no caller changes).

### B. Real-chain integration (Epic I)
- **Legacy retired (H3 #9):** `soroban.service.js` / `og-soro.js` / `web3.service.js` deleted;
  `certificate.service` + `/soroban/*` ops routes repointed to the adapter. This removed the last
  live-network tests from the default suite (the 2 chronic `soroban.service.int` failures are gone).
- **Wallet funding (B5):** freshly-created custodial wallets are testnet-friendbot funded on the
  admin-gated onboarding steps (company approval, sub-admin activation) via
  `services/funding.service` (`AUTO_FUND_WALLETS`, real-mode only, best-effort). Mainnet funding is
  a clearly-marked treasury seam. Proven live: a brand-new wallet funds + signs `store_document`.
- **I3 golden path:** `npm run test:live` includes a full service-level flow against the deployed
  contract with the indexer mirroring into Mongo (see the adapter spec).

### C. Durability & correctness
- **Durable outbox (H3 #6, `models/Outbox` + `services/outbox.service`):** `writeThrough` persists
  a pending mirror row **before** applying it, so a crash between "chain write succeeded" and "DB
  mirror" self-heals — the outbox processor replays the idempotent mirror with backoff (dead-letters
  after `maxAttempts`). Scheduled + `POST /admin/jobs/outbox`.
- **Reconcile scheduled** (chain = source of truth) via the scheduler + `POST /admin/jobs/reconcile`.
- **Concurrency (H3):** two officers reviewing the same doc no longer lose a review — the reviews
  array mutation is an **atomic positional upsert** (`indexer.mirrorReview`); off-chain
  framework-proposal signing uses an atomic `$addToSet` + single-flip execute (no double-apply);
  same-signer transactions are **serialized** (`utils/mutex`) so sequence numbers can't collide,
  with the `tx_bad_seq` rebuild-retry as a backstop.

### D. Operations & hardening
- **`GET /health`** (liveness — always 200 if the process is up) and **`GET /ready`** (readiness —
  503 if Mongo down or, in real mode, the Soroban RPC is unreachable; also reports outbox backlog).
- **Storage abstraction (H4 #11, `services/storage.service`):** `STORAGE_DRIVER=auto|disk|gridfs|memory`.
  Uploaded documents default to **GridFS** (survive a multi-instance deploy); disk kept as one impl;
  `GET /documents/:id/file` now streams from whichever driver stored it. S3/MinIO is a drop-in seam.
- **Scheduler (D12, `services/scheduler`):** outbox/expiry/reconcile run on intervals, each under a
  **lease-based distributed lock** (`models/JobLock` + `utils/lock`) so only one instance runs a job
  at a time. `ENABLE_SCHEDULER` (default on in prod). Expiry keeps its injectable `now` for tests.
- **Audit auth failures (D13):** the audit middleware now records `denied` (401/403/429 — failed
  logins, forbidden access, lockouts) and `error` (5xx on mutations), not just successful mutations.
- **No secrets logged (D13):** `utils/logger` redacts any sensitive-looking meta key
  (password/secret/token/apikey/authorization/private-key/mnemonic) → `[REDACTED]`, recursively.
- **Refresh-token reuse detection (D13):** presenting an already-revoked (rotated) refresh token is
  treated as theft — all of that user's sessions are revoked and the attempt rejected 401.
- **`npm audit`** (prod deps): **0 critical / 0 high** (3 moderate remain in the dev-only
  `mongodb-memory-server` — acceptable).
