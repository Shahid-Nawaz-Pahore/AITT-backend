# API Endpoints (MVP)

## Auth
- POST /api/v1/auth/register  (admin only - create users)
- POST /api/v1/auth/login
- POST /api/v1/auth/refresh
- POST /api/v1/auth/exchange-key  (keeps API keys in DB, not used by main routes)

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
- `POST /admin/jobs/expiry` (admin) — run the expiry job (issued→expired + critical/warning alerts + notifications). Wire to cron in prod.
- `GET /admin/audit` (admin) — request-level audit trail (paginated).

### Hardening
- Global **audit middleware** records every successful mutating request (`AuditLog`).
- **Expiry job** transitions `issued→expired` + raises alerts/notifications; idempotent.
- `wallet.js` **hard-fails in production** without `KEY_ENCRYPTION_SECRET`.
- Seed defaults: `node src/migrations/seed-p5.js` (frameworks + templates, idempotent).
