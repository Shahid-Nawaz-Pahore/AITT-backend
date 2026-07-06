# Soroban Adapter Specification

The **sorobanAdapter** (`src/services/sorobanAdapter/`) is the single seam for **all**
chain access in the backend. Nothing else in the codebase talks to Stellar/Soroban
directly (the legacy `soroban.service.js` was retired — H3 #9). Two interchangeable
implementations expose the identical interface:

| Impl | File | Selected when | Purpose |
|------|------|---------------|---------|
| `stub` | `stub.js` | `SOROBAN_ADAPTER=stub` (default) | In-memory mirror of the deployed ABI. Deterministic, no network. Ships for tests/dev. |
| `real` | `real.js` | `SOROBAN_ADAPTER=real` | Wraps the **deployed** contract `CA6KYPPXEUTAP4X6JAEOI37OD2SCKEAUOSV2VN5ICDWCAI4WASFHRSYB` (testnet, protocol 27). |

Selection: `getAdapter()` in `index.js` reads `SOROBAN_ADAPTER` (`real` | `stub`; or the
legacy `USE_SOROBAN_STUB=false` ⇒ real). In `NODE_ENV=production` the app **refuses to
boot** unless `SOROBAN_ADAPTER=real` (audit C2 — no silent fake chain in prod; enforced by
`src/config/env.js`).

## Interface

`INTERFACE_METHODS = READ_METHODS ∪ WRITE_METHODS` (see `index.js`). Every method exists,
with identical signatures and return shapes, on **both** impls.

### Reads (simulate-only; no fee, no state change)

| Adapter method | Contract fn | Args | Returns (normalized) |
|----------------|-------------|------|----------------------|
| `mainAdminAddress()` | `main_admin_address` | — | `G…` address string |
| `governanceThreshold()` | `governance_threshold` | — | `Number` (N) |
| `isSubAdmin(addr)` | `is_sub_admin_public` | address | `Boolean` |
| `isWhitelisted(addr)` | `is_whitelisted` | address | `Boolean` |
| `readDocument(hash)` | `read_document` | string | `{ name, hash, timestamp:Number, added_by, status:String, expiry:Number }` or `null` |
| `verifyDocument(hash)` | `verify_document` | string | `{ name, hash, timestamp, added_by, verified_document:Bool, certificate_status:String, expiry:Number }` |
| `readReview(hash, reviewer)` | `read_review` | string, address | `{ reviewer, status:String, score:Number, comment_hash, timestamp:Number }` |
| `readProposal(id)` | `read_proposal` | u64 | `{ id:Number, action:{type,…}, approvals:String[], executed:Bool }` |

### Writes (build → simulate → sign → send → bounded-confirm; return a receipt)

| Adapter method | Contract fn | Signed by | Notes |
|----------------|-------------|-----------|-------|
| `init(opts)` | `init` | service key | one-time bootstrap |
| `addSubAdmin(admin, sub, opts)` | `add_sub_admin` | main admin | idempotent |
| `removeSubAdmin(admin, sub, opts)` | `remove_sub_admin` | main admin | decrements M |
| `setThreshold(admin, n, opts)` | `set_threshold` | main admin | 1 ≤ N ≤ M |
| `whitelistAddress(addr, opts)` | `whitelist_address` | main admin | company approval |
| `removeFromWhitelist(addr, opts)` | `remove_from_whitelist` | main admin | |
| `storeDocument(actor, name, hash, opts)` | `store_document` | **actor** (custodial) | company wallet signs; `opts.signerSecret` |
| `issueCertificate(admin, hash, expiry, opts)` | `issue_certificate` | main admin | requires an approving review on-chain |
| `submitReview(sub, hash, status, score, commentHash, opts)` | `submit_review` | **sub-admin** (custodial) | `status` = contract `DocumentStatus` name |
| `createProposal(proposer, action, opts)` | `create_proposal` | proposer | returns `{…receipt, proposalId:Number}` |
| `approveProposal(sub, id, opts)` | `approve_proposal` | **sub-admin** (custodial) | auto-executes at threshold |
| `transferMainAdmin(newAddr, opts)` | `transfer_main_admin` | main admin | **never exercised live** (simulation-only) |

**Custodial signing (A2):** writes default to the service/main-admin key. `opts.signerSecret`
signs as a specific party (a company for `store_document`, a sub-admin for `submit_review` /
`approve_proposal`) so the tx **source** matches the address the contract `require_auth`s.
Per-signer sends are serialized (`utils/mutex`) so their sequence numbers can't collide, with
a `tx_bad_seq` rebuild-and-retry backstop in `rpc.js`.

### Receipt shape

```
{ hash, status, ledger, feeCharged, latencyMs, returnValue, source, proposalId? }
```
`source` is `'real'` (status `SUCCESS`) or `'stub'` (status `'simulated'`). The indexer maps
this to a `Web3Tx.status` of `confirmed` | `simulated` | `failed`.

## Encode / decode rules

Soroban `#[contracttype]` **enums without integer discriminants** serialize as
`ScVal::Vec([Symbol(variant), …payload])`. `u64`/`i64` surface as decimal **strings** (bigint).
The adapter normalizes both directions so the rest of the backend is byte-for-byte agnostic to
which impl is live:

- **Encode** (`rpc.js`): `enumScVal(variant, …payload)` → `scvVec([Symbol, …])`; `u64ScVal`
  (BigInt), `u32ScVal`, `bytesN32ScVal` (strict 32-byte guard), `addressScVal`, `stringScVal`.
- **Decode** (`decode.js`, the symmetric mirror): array→`{type,…}` for `ProposalAction`
  (`RevokeCertificate(docHash)` / `UpdateThreshold(value)` / `ContractUpgrade(wasmHash)`),
  array/`["Issued"]`→`"Issued"` for status enums, and `u64` string→`Number` (`toNum`) for
  every `id`/`expiry`/`timestamp` (all in-range < 2^53). Decoders are pure, idempotent, null-safe.

### Proposal-type mapping (`index.js`)

Frontend `ProposalType` → on-chain `ProposalAction`:
`revocation → RevokeCertificate`, `governance_rule → UpdateThreshold`,
`contract_upgrade → ContractUpgrade`. **`framework_update` is off-chain (gap #1)** — it has NO
on-chain action; `mapProposalAction` throws if it reaches the adapter (governed entirely in the
DB by `proposal.service`).

## Stub ↔ real parity guarantee

The stub is a faithful in-memory model of the deployed ABI: whitelist / sub-admin sets, the
4-state document lifecycle (`Submitted/Issued/Revoked/Expired`), per-officer reviews (latest
wins), the 3 on-chain proposal actions with auto-execute at threshold, the double-approve guard,
`issue` gated on an approving review, and state-aware `verify` (expiry/revoke). It uses injectable
`now` and deterministic `stub-<method>-<n>` hashes.

**Parity is enforced by the live suite** (`__tests__/live/adapter.reads.parity.live.test.js`):
real reads are asserted **deep-equal** to the stub's shape for documents, reviews, verify, and all
three `ProposalAction` variants — so services built and tested against the stub behave identically
against the real chain.

## Running the live suite

```bash
npm run test:live        # SOROBAN_ADAPTER=real, jest.live.config.js
```

- Creds come from the deployed-contract fixtures (never committed to `.env`):
  `stellar_document_verification_system/deployment-result.json` (contract id + main-admin key)
  and `test-accounts.json` (10 funded wallets). See `__tests__/live/_liveEnv.js`.
- Without `SOROBAN_ADAPTER=real` the live files self-skip (`liveDescribe`), so the default
  `npm test` collects them but runs nothing live.
- Suites:
  - `adapter.reads.parity.live.test.js` — real reads == stub (byte-for-byte).
  - `adapter.writes.live.test.js` — every write validated by a follow-up read;
    `transfer_main_admin` by **simulation only** (never hands admin of the shared contract away).
  - `golden-path.services.live.test.js` — **I3**: the full flow through the SERVICE layer
    (onboard → fund fresh wallet → submit → review → issue → verify → revoke-proposal → sign →
    auto-execute) with the indexer mirroring chain state into a real (in-memory) Mongo.

## Durability across the seam

Adapter writes go through `indexer.writeThrough`, which persists a **durable outbox** row
(`models/Outbox`) immediately after the chain confirms and before the DB mirror, so a crash
between "chain write succeeded" and "DB mirror" self-heals (`outbox.service` replays the
idempotent mirror). `reconcile.service` treats the chain as the source of truth and repairs any
residual drift (scheduled + `POST /admin/jobs/reconcile`).
