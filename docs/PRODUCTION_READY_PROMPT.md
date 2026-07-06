# Autonomous Prompt — Take the AITT Backend Integration to Fully Production-Ready

> Paste everything below the line into a fresh Claude Code session (opened at the repo root
> `Downloads/AITTsoroban (2)/AITTsoroban`). It is written to be executed **autonomously**:
> the agent finishes the job end-to-end, tests relentlessly, and does **not** stop for
> per-phase sign-off. Hand it over and let it run.

---

## Role

You are a senior backend + blockchain-integration engineer. You own the AITT compliance-certification
backend (Node/Express/MongoDB) that wraps a **live, deployed Soroban smart contract** on Stellar testnet.
Your job is to take it from "built and audited" to **genuinely production-ready and integrated against the
live contract** — and to prove it with tests you run again and again until they are green and stable.

## Mission (the one sentence)

Ship a fully production-ready backend that talks to the **real** deployed contract
`CA6KYPPXEUTAP4X6JAEOI37OD2SCKEAUOSV2VN5ICDWCAI4WASFHRSYB` (testnet, protocol 27) — every hardening item
closed, the real Soroban adapter validated against the live chain, all tests passing repeatedly with zero
regressions, and a clean end-to-end boot proven.

## Autonomy contract — READ THIS FIRST

This is the important part. Previous work on this repo was **phase-gated**: the engineer stopped after every
phase and waited for me to return a punch-list. **That is over. Do not do that here.**

- **Work end-to-end without stopping for my approval.** Do not ask "should I proceed?", do not pause for
  sign-off between items, do not wait for a punch-list. Just keep going until the whole job is done.
- **Decide and document, don



't ask.** When you hit a design choice, pick the most defensible, most
  production-safe option, implement it, and record the decision (what/why/alternatives) in your running log
  and in `backend/docs/API.md`. Only surface a question if you are truly blocked by something you cannot
  determine or safely default (e.g. a real production secret you don't have) — and even then, keep making
  progress on everything else first.
- **The bar is "I could deploy this to real users tomorrow,"** not "the tests pass." Think like the person
  who gets paged at 3am if it breaks.
- **Extend, don't rewrite.** This codebase was built in disciplined phases; preserve its structure,
  conventions, and existing tests. Every behavioural change ships with a test.
- **Never regress.** The full suite must stay green (minus the two known live-testnet failures, which you
  are going to fix — see below). If a change breaks a test, fix the cause, not the test.

## Context you are inheriting (verify before trusting — this is from memory, code is truth)

- **Working dir:** `backend/` inside `Downloads/AITTsoroban (2)/AITTsoroban`. Node 20/24, `npm install` works.
- **Test commands:**
  - `npm test` → `cross-env NODE_ENV=test jest --runInBand` (uses mongodb-memory-server; set
    `USE_DISK_UPLOAD=false`). Last known baseline: **245 passed / 2 failed / 2 skipped**.
  - `npm run test:live` → `SOROBAN_ADAPTER=real jest --config jest.live.config.js` (hits the live contract).
    Last known: **14/14 green** (parity + write validation).
- **The 2 known failures** are `soroban.service.int` ×2 — they come from the **LEGACY** `soroban.service.js`
  live-read error-wording, **not** from the real `sorobanAdapter`. Retiring/fixing the legacy path is part of
  this job; do not accept them as permanent.
- **The chain adapter** lives in `backend/src/services/sorobanAdapter/` (`index.js`, `real.js`, `stub.js`,
  `rpc.js`, `decode.js`). `SOROBAN_ADAPTER` env selects `stub` (default) or `real`. The **stub** is a
  fully test-verified in-memory mirror of the deployed ABI; **`real.js`** wraps the deployed ABI and has been
  parity-validated live (Epic I, phases I1–I2).
- **Live credentials ARE available** in `stellar_document_verification_system/deployment-result.json`
  (main-admin `wallet-01` secret) and `test-accounts.json` (10 funded wallets). Contract state is **not
  clean** — threshold=2, wallet-02/03 are sub-admins, wallet-04 whitelisted, proposal id 1 exists & executed.
  Any live golden path must tolerate pre-existing state and monotonic proposal IDs > 0.
- **Key custody model is DECIDED:** backend-custodial, one Stellar key per officer/company, AES-256-GCM
  encrypted at rest via `KEY_ENCRYPTION_SECRET`. Do not reopen this.

Before acting on any of the above, **verify it against the current code** — these notes are days old.

## The work (close all of it — this is the definition of done)

Work through everything below. Order it sensibly (config/env foundation first, then adapter/integration,
then durability, then ops), but the acceptance bar is that **all of it is done**, not that any one phase is
"approved."

### A. Startup safety & config (remediation H2)
1. `src/config/env.js` — fail-fast startup validation of all required env (joi or envalid). Missing/invalid
   config must crash on boot with a clear message, never limp along.
2. **Fold in audit finding C2:** in `NODE_ENV=production`, refuse to boot if `SOROBAN_ADAPTER` is not `real`
   (no silent fake-chain in prod). Likewise refuse if `KEY_ENCRYPTION_SECRET` / JWT secrets are unset in prod.
3. Wallet key encryption versioning: prefix ciphertext (`gcm:v1:…`), add a `rotateKey` seam, leave a KMS
   integration TODO with a clean boundary.

### B. Real-chain integration (Epic I, phases I3–I4)
4. **I3 — golden path through the services, not just the adapter.** With `SOROBAN_ADAPTER=real`, drive the
   full flow (register company → approve/whitelist → invite/activate sub-admin → submit document → review →
   issue certificate → verify → governance proposal → sign → auto-execute) and confirm the **indexer mirrors
   chain state into Mongo** correctly and services consume `readProposal().action` as the `{type,...}` stub
   shape. Fix any read/decode or mirror drift you find.
5. **Unfunded-wallet gap:** the real onboarding path never funds newly-created custodial wallets, so real-mode
   writes from a fresh officer/company fail. Wire friendbot funding (testnet) into onboarding behind a config
   flag, with a clear seam for mainnet funding. Prove a brand-new wallet can transact.
6. **I4 — author `docs/soroban-adapter-spec.md`** (the brief references it; it doesn't exist). Document the
   adapter contract: every method, its ABI mapping, encode/decode rules, the stub↔real parity guarantee, and
   how to run the live suite.
7. **Retire the legacy `soroban.service.js` / `og-soro.js`** write paths (remediation H3 #9). All chain access
   goes through the adapter. This is what kills the 2 remaining `soroban.service.int` failures — do it
   properly (remove dead code + its tests, or repoint them at the adapter), don't paper over.

### C. Durability & correctness (remediation H3)
8. **Chain↔DB durability:** replace best-effort `recordTx`/mirroring with a durable outbox + retry so a
   crash between "chain write succeeded" and "DB mirror" self-heals. Schedule `reconcile.service` to run and
   treat the chain as source-of-truth.
9. **Concurrency:** fix read-modify-write races on reviews / proposal signs (atomic updates or guarded
   writes). Fix service-key sequence-number contention and `tx_bad_seq` ret/retry under concurrent writes.

### D. Operations & hardening (remediation H4 + quick wins)
10. `/health` (liveness) and `/ready` (checks Mongo + RPC reachability) endpoints.
11. Storage abstraction (GridFS or S3-style) behind the current disk/memory upload so uploads survive a
    multi-instance deploy; keep local disk as one implementation.
12. Real scheduler for the expiry job (node-cron or equivalent) with a lock so it doesn't double-run across
    instances; keep the injectable `now` for tests.
13. Audit auth failures (not just successful mutations); ensure **no secrets are ever logged**; add refresh-
    token reuse detection.
14. `npm audit` clean of prod-dependency criticals/highs (dev-only moderates from mongodb-memory-server are
    acceptable — note them).

### E. Fresh production-readiness audit (do this at the end, adversarially)
15. After the above, re-run a **read-only production-readiness audit** as if you were a skeptical reviewer who
    wants to block the release. Anything you find, fix. Repeat until the audit comes back clean. Cover at
    least: authz on every route, input validation, rate limits, error handling / no stack leaks, secrets
    handling, chain-failure behaviour, and multi-instance safety.

## Testing discipline — "test it again and again"

This is non-negotiable. You do not get to declare done because one green run happened.

1. **After every change:** run `npm test`. Keep it green. Every fix ships its own test.
2. **For anything touching the chain adapter:** run `npm run test:live` against the real contract and confirm
   real↔stub parity still holds byte-for-byte.
3. **Before declaring done, run the full suite 3× in a row** to catch flakiness — especially the rate-limiter,
   lockout, concurrency, outbox/retry, and scheduler tests. Any non-deterministic test is a bug; fix it.
4. **Boot it for real:** start the server (`npm start` with a proper `.env`), hit `/health` and `/ready`,
   and run the live golden path end-to-end against the real contract. Watch the logs for anything ugly.
5. **`npm audit`** and confirm the criticals/highs are gone.
6. Keep a running tally in your final report: suite counts before/after, live-suite result, audit result,
   and the 3× stability runs.

## Live-contract safety rails (do NOT skip)

- The deployed contract is **shared** and its state matters. **Never** actually call `transfer_main_admin`
  against it for real — validate that path by simulation only (as prior work did). Handing admin to another
  key is irreversible on a shared contract.
- Live writes cost testnet funds and mutate shared state; prefer the pre-funded wallets in
  `test-accounts.json`, tolerate existing state, and never assume a clean contract.
- Never commit or log any secret from `deployment-result.json`, `.env`, or `test-accounts.json`.

## Definition of "production-ready" (your acceptance checklist — all must be true)

- [ ] `npm test` green, run 3× consecutively with no flakes; the 2 legacy `soroban.service.int` failures are
      **gone** (legacy path retired), not tolerated.
- [ ] `npm run test:live` green against the real contract; real↔stub parity proven.
- [ ] Server refuses to boot in prod with a fake/stub adapter or missing secrets (C2 closed).
- [ ] Fresh custodial wallet can transact on the real chain (funding gap closed).
- [ ] Chain↔DB writes are durable (outbox/retry) and reconcilable; concurrency races fixed.
- [ ] `/health` + `/ready` live; expiry job scheduled + locked; uploads survive multi-instance.
- [ ] Your adversarial re-audit comes back with **no** critical/high findings.
- [ ] `docs/soroban-adapter-spec.md` written; `API.md` + `.env.example` updated for every change.
- [ ] `npm audit` clean of prod criticals/highs.

## Deliverable

When (and only when) every box above is checked, give me a single **final report**:
- what changed, grouped by area (A–E), with the key decisions you made and why;
- before/after test counts, the live-suite result, the 3× stability result, and the re-audit result;
- anything that is genuinely infra/ops-owned (real KMS, mainnet funding source, production Mongo/secret
  store) left as a clearly-marked TODO with a clean seam — but nothing in the code left half-done.

Now begin. Don't wait for me — work the whole list, test it relentlessly, and hand me a production-ready app.
