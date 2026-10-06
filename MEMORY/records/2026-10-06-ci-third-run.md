# 2026-10-06 — CI's third run on `4584df3`: a page order with a tie, and `source-map-js`

**Run:** GitHub Actions `ci` run 37401999535 on `4584df3` (pushed to `main`). 9 of 11 jobs green.
**Author:** CI third-run agent, for the coordinator. No commit or push was made by this agent.
**ADR:** none. Adding a unique last key to a page order changes no contract (each list keeps its primary sort, documented nowhere as "ties in insertion order"). The lockfile change is a patch-level transitive bump.

## What failed

Both read from the public annotations (`scripts/ci/jest-annotate.js`, ADR-117 §5), which worked as intended: the failing test, its line and its diff were in the annotation.

| Job (id) | Step | Annotation |
|---|---|---|
| backend unit + coverage gate (100%) (112071046261) | `npm run test:coverage` | 1 of 15,301 failed: `services/accessRequest.service.p1005.test.ts:302`, "P10-07 — the queue › lists one status, newest first, …": expected `["RSUD again","Klinik B"]`, received `["Klinik B","RSUD again"]` |
| npm audit (high and critical fail) (112071046357) | `npm audit --omit=dev --audit-level=high` (production, no exceptions) | new HIGH **GHSA-68fv-2mgg-jv7q**, `source-map-js` ≤ 1.2.1 (event-loop DoS through indexed source-map section offsets), `fixAvailable: true` |

## A — the queue's order had a tie, and so did 41 other page queries

### Cause

`accessRequest.service#listAccessRequests` ordered by `[["createdAt", "DESC"]]` alone. The test submits three requests back to back; on the CI runner two of them got the **same millisecond**. With a tie, the order is not the service's but the store's: memoryDb sorts stably, so a tie keeps insertion order (Klinik B before RSUD again), which is what CI received. Locally the three rows were a few ms apart, so the test passed.

That is a test flake **and** a real defect. On PostgreSQL, `ORDER BY created_at DESC LIMIT n OFFSET m` over tied rows has no defined order between them, and it may differ between two statements, so one row can be on page 1 and page 2 while another is on neither. U-06's record had already noted it for the record list ("a tiebreaker (`id`) would make paging deterministic"); the same shape was everywhere.

### Fix — the root, then the class

Every paginated query now ends its order with the row's id, in the direction of the primary sort; the primary sort is unchanged. Every model's primary key is `id` (the guard checks that too), so the order is total.

**The 42 queries given a tiebreaker** (the list is the guard's own scan of `HEAD`, below):

| File | Line at `HEAD` | Query | Order now |
|---|---|---|---|
| `controllers/session.controller.ts` | 162 | `Sessions.findAndCountAll` (`getAllSessions`) | `createdAt DESC, id DESC` |
| `models/tenantBackup.model.ts` | 414 | `TenantBackup.findAndCountAll` (`getTenantBackups`) | `createdAt DESC, id DESC` |
| `models/tenantBackup.model.ts` | 435 | `TenantBackup.findOne … limit: 1` (`getLatestBackup`) | `createdAt DESC, id DESC` |
| `services/accessRequest.service.ts` | 314 | the access-request queue | `createdAt DESC, id DESC` |
| `services/admin.service.ts` | 92 | tenants (platform admin) | `createdAt DESC, id DESC` |
| `services/apiKey.service.ts` | 194 | API keys | `createdAt DESC, id DESC` |
| `services/attachment.service.ts` | 780 | attachments | `createdAt DESC, id DESC` |
| `services/audit.service.ts` | 460 | audit log | `createdAt DESC, id DESC` |
| `services/batchJob.service.ts` | 387 | batch jobs | `createdAt DESC, id DESC` |
| `services/billing.service.ts` | 341 | invoices | `createdAt DESC, id DESC` |
| `services/calibrationDevices.service.ts` | 281 | devices | `name ASC, id ASC` |
| `services/calibrationDevices.service.ts` | 337 | a device's last 10 records (`separate` include) | `calibrationDate DESC, id DESC` |
| `services/calibrationRecords.service.ts` | 186 | calibration records (U-06 page) | `calibrationDate DESC, id DESC` |
| `services/certificate.service.ts` | 614 | certificates (sortable) | `<sortBy> <dir>, id <dir>` |
| `services/content.service.ts` | 329 | posts (admin) | `createdAt DESC, id DESC` |
| `services/content.service.ts` | 506 | posts (public) | `publishedAt DESC, createdAt DESC, id DESC` |
| `services/finance.service.ts` | 243 | asset finance | `purchaseDate DESC, id DESC` |
| `services/maintenance.service.ts` | 157 | work orders | `createdAt DESC, id DESC` |
| `services/meteredBilling.service.ts` | 668 | metered invoices | `createdAt DESC, id DESC` |
| `services/notification.service.ts` | 303 | notifications | `createdAt DESC, id DESC` |
| `services/ownSessions.service.ts` | 141 | own sessions (capped) | `created_at DESC, id DESC` |
| `services/qms.service.ts` | 275, 407 | non-conformances, CAPAs | `createdAt DESC, id DESC` |
| `services/risk.service.ts` | 126 | risks | `createdAt DESC, id DESC` |
| `services/roles.service.ts` | 353, 929 | roles, menu groups | `sort_order ASC, created_at ASC, id ASC` |
| `services/scim.service.ts` | 404 | SCIM `/Users` — **had no order at all** | `createdAt ASC, id ASC` (as `/Groups`) |
| `services/scim.service.ts` | 1150 | SCIM `/Groups` | `createdAt ASC, id ASC` |
| `services/sop.service.ts` | 161 | SOP documents | `createdAt DESC, id DESC` |
| `services/stock.service.ts` | 202, 624, 952, 1137 | stock, adjustments, transfers, opnames | `itemName ASC, id ASC`; `createdAt DESC, id DESC` ×2; `scheduledAt DESC, id DESC` |
| `services/storageMigration.service.ts` | 268 | attachments to migrate (batch) | `createdAt ASC, id ASC` |
| `services/supplierScorecard.service.ts` | 113 | scorecards | `evaluationDate DESC, id DESC` |
| `services/ticket.service.ts` | 342 | tickets | `createdAt DESC, id DESC` |
| `services/user.service.ts` | 553 | users | `firstName ASC, id ASC` |
| `services/vendor.service.ts` | 158 | vendors | `createdAt DESC, id DESC` |
| `services/warehouse.service.ts` | 149 | warehouses | `name ASC, id ASC` |
| `services/webhook.service.ts` | 323, 462 | webhooks, deliveries | `createdAt DESC, id DESC` |
| `services/webhookDeliveryPurge.service.ts` | 93 | purge batch | `updatedAt ASC, id ASC` |

Already total, untouched: `eSignature#getSignatureHistory` (`signedAt DESC, id ASC`, its own comment says why), `scheduledBackup` (`…, id DESC`), and every keyset batch ordered by `id` alone (`attachmentFileSweep`, `calibrationScheduler`, `dataRetention`, `gdpr`, `kanban`, `sop` approvers, `storageMigration` certificates/backups, `tenant`, `tenantLifecycle`, `scheduledBackup` tenants).

**Not changed, and why:**
- `findAll` with `limit` and no `order` that is not a page: `accessRequest` retention batches (each batch is updated out of the `where`, so the next batch is the rest), `jobMonitor` stuck jobs (alert sample of 20), `meteredBilling#generateUsageReport` (`limit: 1` probe), `signInPolicy#loadNetworkPolicy` (≤ 2 rows by key). The guard leaves a `limit` without `offset` alone when there is no `order`.
- A `findOne` with an `order` and no `limit` in its literal (e.g. the newest tenant key, the newest workflow instance): one row; a tie picks either. Out of the guard's scope (its header says so).
- Raw SQL (`sql()`): `attachment.service` already ends in `a.id`; `search.service` and `ai.service` are rank orders over a `LIMIT` (relevance, not paging); `keyRotation` orders by `id`; `webhook.service`'s retry sweep and `meteredBilling`'s period list are not paged by offset.

**Performance, not measured.** The per-tenant list indexes (0093) and 0109 lead with the primary sort column. PostgreSQL 18 can still use them for `ORDER BY <col>, id … LIMIT` with an Incremental Sort on the id within equal keys, which costs little when ties are few. Not measured on the U-06 stack; if a list regresses, extend that list's index with `id`.

### The test, made deterministic

`accessRequest.service.p1005.test.ts` › "the queue":
- **"lists one status, newest first, …"** now freezes `Date` only (`jest.useFakeTimers({ now, doNotFake: [every timer API] })`) and sets the clock 0 s / 1 s / 2 s for the three submissions: the order asserted is the service's, never the machine's speed.
- **New: "rows created in the same millisecond keep one order — the id breaks the tie, so no page repeats or drops a row".** Three requests at one frozen instant (asserted: one distinct `createdAt`); the full list and three pages of `limit: 1` must both read the ids in descending order, each once.
- **Fail-before:** with the service's order put back to `[["createdAt", "DESC"]]`, the new test fails (the first two ids swapped: the store's insertion order); with the fix it passes.
- **Not flaky:** the suite ×10 in a row, each with all 44 cases passing (43 before, plus the new one) — see § Gates.

`recordsList.u06.test.ts` asserts the generated SQL's outer `ORDER BY "calibrationDate" DESC, "CalibrationRecord"."id" DESC`. Eleven mock-based suites asserted the old `order` arrays; each assertion now names the new array (the intended behaviour change, nothing else touched): `admin.service` (3), `apiKey.service` (1), `batchJob.service` (1), `billing.service` (1), `certificate.service` (2), `qms.service` (2), `risk.service` (2), `sop.service` (1), `storageMigration.service` (2), `supplierScorecard.service` (1).

### The guard — static, over all of `src/` (tests excluded)

`backend/src/tests/guards/pageOrderTiebreaker.ci3.guard.test.ts` (6 cases), with the TypeScript compiler API:
- every object literal with an `order` **and** a `limit` or `offset` (directly or inside a spread such as `...(limit ? { limit } : {})`) must have an array-literal `order` whose last entry is `"id"` or `["id", <dir>]`. Object literals, not just call arguments, so an options object built before the call (eSignature) is checked too; a dynamic order (`ORDER`) fails;
- every `findAndCountAll` with a `limit`/`offset`, and every `find*` with an `offset`, must have an `order`;
- every `*.model.ts` declares exactly one primary key, `id` (73 models);
- self-tests: five shapes it must flag, two unordered pages it must flag, five shapes it must pass;
- non-vacuous: it sees ≥ 50 paginated literals (58 today); `EXEMPT` is empty.

**Fail-before:** the guard's scan over `git archive HEAD` reports **42 findings in 58 paginated literals** (the table above, SCIM `/Users` as "findAndCountAll pages without an order"); on the working tree, 0. Its first run here also found two the hand audit had missed (`tenantBackup#getLatestBackup`, the device's last-10 records include).

## B — `source-map-js`: a patch bump in the lockfile

- **Who pulls it** (`npm ls source-map-js --omit=dev`): one deduped `node_modules/source-map-js@1.2.1`, from `backend > sanitize-html@2.17.7 > postcss@8.5.28`, `backend > @scalar/api-reference@1.72.2 > vue@3.5.43 > @vue/compiler-core|compiler-sfc`, and `frontend > next@16.3.6 > postcss@8.5.23`. All ask `^1.2.x`.
- **Fix:** `npm update source-map-js` → **1.2.2**. `package-lock.json` changes in **one entry, 3 lines** (version, resolved, integrity) — no other package moved; `cls-hooked` stays removed; no `overrides`, no `package.json` change. (`npm audit fix --dry-run` would also have pruned the Babel 8 dev tree, so it was not used.)
- **Not done on the shared tree:** `npm ci` in the repository root failed with `EPERM` on `node_modules/.bin/next.exe`, held by the Phase 11 agent's running `next dev`, after npm had already removed most of `node_modules`. `npm install` from the same lockfile restored it (`npm ls` exit 0, lockfile byte-identical, `sharp` loads). The other agent's jest run was in flight at that moment and may have seen missing modules: **re-run it**.
- **`npm ci` proven in isolation instead:** a scratch copy of the root, workspace `package.json`s and the lockfile: `npm ci --ignore-scripts` → added 1,722 packages, exit 0, lockfile unchanged by it; `npm audit --omit=dev --audit-level=high` there: exit 0.

**The moderate four (not fixed, below the gate):** GHSA-hp3w-g68c-fv3c, `sprintf-js` (every version; no patched release) via `argparse@1` via `@rushstack/ts-command-line` via `umzug` 3 — the four entries are that one chain. Reachable only through `umzug`'s CLI, which `backend/src/scripts/migrate.ts` uses (`migrator.runAsCLI()`): the format strings are argparse's own help text, the arguments an operator's command line. No network input reaches it. The only "fix" npm offers is `umzug@2.3.0`, a major downgrade that would rewrite the migrator — not taken.

## Gates

| Gate | Result |
|---|---|
| `npx eslint` on every changed backend file | clean |
| `npm run typecheck` (backend) | 0 errors |
| `npm run ratchet` | 695 `.js`, at the floor |
| affected suites (`src/tests/services`, `controllers`, `models`, `guards`, `routes`, no coverage) | 626 suites passed, 30 skipped; 10,394 tests passed, 207 skipped, 0 failed |
| `accessRequest.service.p1005.test.ts` ×10 | 10 of 10 runs: 44 passed, 44 total (no coverage, sequential) |
| `npm run test:coverage -- --ci` (Node 26.10.0) | **exit 0, 100 / 100 / 100 / 100**: 891 suites passed, 37 skipped, 0 failed; 15,061 tests passed, 247 skipped; 430 s. A first run (while the Phase 11 agent's frontend jest was running) had 1 failure, a 10 s timeout in `routes/user.passwordReset.a162.test.js` (bcrypt under load; no page query on that path); that suite alone passed 3 of 3 (14/14, 8.7–10.4 s), and the second full run above was clean |
| `npm ci` | see B: EPERM on the shared tree (another agent's `next dev`); exit 0 on an isolated copy |
| `npm audit --omit=dev --audit-level=high` | exit 0 — 4 moderate (above), 0 high |
| `node scripts/ci/npm-audit-gate.js` | "1 high/critical advisory(ies), 0 failing, production tree 0" (`braces`, allow-listed dev-only until 2026-11-05); exit 0 |
| `npm run build:dist` | OK: 612 TypeScript files, contracts 53 |
| `TSX_DISABLE_CACHE=1 npm run load:check` / `-- --src` | OK both: 602 modules, 105 in boot order |
| `next build` | exit 0, on `git archive HEAD frontend` in a throwaway directory inside the repository (removed): the committed frontend source against the updated `node_modules`, without building the Phase 11 agent's half-edited tree or touching its `.next` |

## Open

- CI will be green only after these changes are pushed; nothing here was committed.
- The live access-request test on PostgreSQL (`accessRequest.p1005.live.test.ts`) was not run (no PG 18 stack up); the tie is proven on memoryDb and in the SQL Sequelize generates.
