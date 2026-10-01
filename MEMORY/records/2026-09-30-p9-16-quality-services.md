# 2026-09-30 — P9-16 Quality: workflow, qms, risk, supplierScorecard and vendor converted; the stock opname audited

**ADR:** ADR-087. The amendment text is at the end of this record, for the Phase 9 lead to merge.
**Card:** P9-16, all five modules.
**Also recorded here:** the P6-11 stock-take gap the coordinator assigned (`stock#createOpname` / `#updateOpnameStatus`).
**Agent:** Phase 9 services helper. No git writes were made.

## What changed

| Module | Now | Gates |
|---|---|---|
| `services/workflow.service.js` | `.ts`. `services/workflow.service.d.ts` deleted (declarationDrift.p912 passes without it). | four gates |
| `services/qms.service.js` | `.ts`, after `claimNumber` moved to `sql()` as its own change | four gates |
| `services/risk.service.js` | `.ts` | standard method |
| `services/supplierScorecard.service.js` | `.ts` | standard method |
| `services/vendor.service.js` | `.ts` | standard method |

**Snapshots.** Each `.js` was snapshotted only after the agent with edits in it confirmed it was finished:

- `workflow`: security-followups (A-282) and P6-11, which re-classified `startWorkflow` in its guard.
- `risk`, `supplierScorecard` and `vendor`: P6-11 (A-278 audit rows) and the correctness batch (Q-52 `notes`).

**Method.**

- The `.ts` was written and proved in a scratch mirror of `src/`.
- It was swapped in one step: `cmp` of the `.js` against its snapshot, then `cp` of the `.ts` and `rm` of the `.js`.
- `npm run load:check -- --src` was run after each swap.
- No module has a named export beside `export =`, and the lint rule EXPORT_EQUALS_ALONE is clean.

## The pattern, as applied

**workflow** is a class instance.

- `export = workflowService`, where `workflowService` is a `new WorkflowService()` with `RESOURCE_MENUS` and `CERTIFICATE_APPROVAL_NEEDS_REAUTH` added as own properties, in the `.js`'s order.
- The 13 methods are on the prototype, non-enumerable, and have the same names, lengths and order (ES2025 target).
- Internal calls stay `this.x`, so a spy on the instance still intercepts them. The harness proves this with `_auditDefinition`, `getWorkflowById` and `_updateTargetResourceStatus`.
- The two lazy requires stay lazy, and the harness counts the loads: `dynamicAccess.middleware` and `certificate.service` (on a Certificate decision only).
  - Both are still JavaScript, so the members this module calls are typed locally (`CertificateWorkflowHooks`, `DynamicAccessGate`).
  - I did not add a `.d.ts` beside `certificate.service.js`: it is the P9-14 lane's file.
- `findPendingInstance` is typed to return the instance with `workflow` present, since its include is `required: true`. This keeps `stock.service.ts`'s `pending.workflow.name` sound now that the `.d.ts` is gone.
- The unused `User` destructure from the barrel was dropped. It was a property read with no side effect.
- The `submitAction` reads keep the `.js` order: the status 409 comes before any read of the workflow.
- `return this.getWorkflowById(...)` inside `try` stays un-awaited, as built, under a reasoned directive. A failed re-read after commit is still not caught by the rollback.

**The other four** are `export =` of an object literal in the original key order.

- `risk` keeps `ASSIGNEE_NOT_FOUND` first.
- `risk#updateRisk` / `#deleteRisk` and `supplierScorecard#update` / `#delete` called `this.getXById`, which at CommonJS top level is `module.exports`. They now call it through the exported object, and the harness proves a spy still intercepts it.
- `vendor` still loads `redis.service` at load, as a side-effect import. The `.js` destructured four members from it and used none.

## qms: `claimNumber` moved to `sql()` first (its own change)

**The change.** The per-tenant counter upsert used `replacements` (`:tenantId`, `:kind`, `:pattern`), which `sql()` refuses and which is a lint error in `.ts` (P9-07). It now runs `sql(db, …, [tenantId, kind, pattern], { transaction })`:

- `$1` is the tenant, used twice, so the tenant predicate is bound;
- `$2` is the kind and `$3` the pattern;
- the query runs with `type: "SELECT"`, so the RETURNING rows come back as the array.

The identifiers still come from `QMS_NUMBERING`, which is code constants.

**Test edits.** Five doubles and assertions were changed to read `bind` / `type` and return rows instead of `[rows]`:

- `qms.service.test.js`: the 2 claim assertions and 3 mock resolutions;
- `qms.audit.a66.test.js`: the ledger double;
- `qms.numbering.a73.test.js`: the concurrency double. It now also asserts `WHERE tenant_id = $1` and `type: "SELECT"`;
- `qms.tenancy.a75.test.js`: the counter double;
- `webhookEmit.a11.test.js`: the claim mock.

**Results.**

- Fail-before: against the pre-change `.js`, those suites failed **21 of 871** tests.
- After the change: 30 suites, 871/871, and `qms.service.js` at 100%.
- The live check below proves the bound statement on PostgreSQL 18.

## Identity evidence

Each module was compared against its working-copy snapshot, compiled by TypeScript 7 from `tsconfig.build.json`, with recording fakes at the module boundary and a frozen clock. Every harness caught every applied plant.

| Module | Checks | Different | Plants caught | Scratch script |
|---|---|---|---|---|
| workflow | 1,518 | 0 | 6/6 | `p9com/cmp-workflow.js` |
| qms | 1,054 | 1 (names) | 5/5 | `p9com/cmp-qms.js` |
| risk + supplierScorecard + vendor | 591 | 3 (names) | 9/9 | `p9com/cmp-quality3.js` |

"(names)" is the accepted `Function.name` of `exports.x = async () =>` functions. Lengths are identical.

**What each harness covered:**

- **workflow:** every `submitAction` path across 15 instance shapes × 2 users × 5 decisions × 9 modes:
  - 404, closed 409, missing step 500, wrong role 403, missing menu 403, already acted 409;
  - step advance, a step needing N approvals, the StockTransfer / MaintenanceWorkOrder / Certificate branches;
  - the ADR-101 separation-of-duties refusal, missing re-authentication 400, re-authentication failure;
  - audit, save and commit failures.

  It also covered definition create/update/delete, including the 409s, `startWorkflow` fail-soft vs in-transaction re-throw, `getPendingTasks`, and late binding.
- **The workflow plants:**
  - the approval count `>=` changed to `>`;
  - the SoD check removed;
  - `reauthenticated` falsified;
  - the transfer landing on `completed`;
  - the lock removed;
  - the certificate require made eager.
- **qms:** NC and CAPA create and update across actors and 7 modes: audit, save and query failures, empty RETURNING, a 6-digit sequence, no transaction. Also the approval-records-the-caller rule (A-62), the CLOSED webhook, and the lists.
- **risk / supplierScorecard / vendor:** create/update/delete/qualify across 4 actors × 4 modes, the lists, null-throws, and late binding.

## The four gates (workflow and qms)

| Gate | workflow | qms |
|---|---|---|
| (a) guards bite on the `.ts` | Planted in `workflow.service.ts` and failing:<br>- **d12**: a Role include without `required`;<br>- **d24**: a new unbounded `Role.findAll`;<br>- **auditCoverage.p611**: `deleteWorkflow`'s audit call renamed, reported as "services/workflow.service#deleteWorkflow".<br>All green again on restore. | Planted in `qms.service.ts`, one failure each:<br>- **d12**: an include `required: undefined`;<br>- **d05** (raw-SQL tenant predicate): `WHERE tenant_id = $1` removed from the `sql()` statement;<br>- **p611**: `updateNC`'s audit call removed.<br>41/41 green on restore. |
| (b) identity | 1,518 checks, 0 different, 6/6 plants | 1,054 checks, names only, 5/5 plants |
| (c) suites | 113 suites: every workflow, certificate-approval, e-signature and SoD suite; every `*.twoTenant*`; the `tenantScope.*` suites; all guards. **3,078 passed.** The one failure was p611's stale entry for `startWorkflow`, which the guard fix below resolved. `workflow.service.ts` at 100%. | 32 suites (every qms, e-signature-gate and route-guard suite, d05, d12, p611, d24): **878 passed**. The one failing suite was `0024-qms-number-uniqueness`, which read the `.js` path. Re-keyed to `.ts` (allowed), 12/12. `qms.service.ts` at 100%. |
| (d) live PostgreSQL 18.6 as `callibrator_app` | **27/27** (`p9com/live-workflow.js`) | **20/20** (`p9com/live-qms.js`) |

### The live runs

**Setup.**

- A fresh `pgvector/pgvector:pg18` container (PostgreSQL 18.6), migrated by booting the backend from source (`node --import tsx index.js`). Its log shows "Database queries now run as the application role "callibrator_app"".
- Each script creates its fixtures as the owner, switches every connection with the backend's own `enterApplicationRole`, and runs each check inside a real `tenantContextMiddleware` context.
- The container and the scratch junctions were removed afterwards.

**workflow checks (27):**

- **Role and setup:**
  - the module is the `.ts`;
  - `current_user` is `callibrator_app`.
- **Tenant A's lifecycle:**
  - A defines a workflow; its steps are read back through the LEFT role include;
  - the definition's CREATE audit row is in A's trail;
  - `stock.createTransfer` starts the workflow **in its transaction**, and the transfer's audit row records the `workflowInstanceId`;
  - a pending transfer cannot be moved by hand (409);
  - a started workflow's steps cannot be replaced (409);
  - a workflow with a pending instance cannot be deleted (409).
- **Tenant B against A:**
  - B's approver sees none of A's tasks;
  - B deciding on A's instance is **404, not 403**;
  - B lists no A workflow and finds no pending instance on A's transfer.
- **The decision:**
  - a user without the step's role gets 403;
  - A's approver sees the task and approves it;
  - the transfer is `in_transit` and names its approver;
  - one `workflow_actions` row is written;
  - the APPROVE audit row and the transfer's WORKFLOW_APPROVE row are in A's trail;
  - a second decision gets 409.
- **Certificate (ADR-101):**
  - a Certificate workflow starts;
  - an approval without re-authentication is 400;
  - **the certificate's author is refused with the separation-of-duties message (403) before re-authentication**, and the refusal records nothing;
  - control: a non-author of the same role passes SoD and is stopped at re-authentication instead.
- **An error in my script, fixed.** The first run's SoD check passed for the wrong reason: the approver lacked `certificate` write, so the 403 was the A-183 menu gate. I granted the menu and made the check assert the SoD message itself, then added the control above. No code changed.

**qms checks (20):**

- **Role and setup:** the module is the `.ts`; the application role is in effect.
- **Numbering on PostgreSQL:**
  - the first NC is `NC-00001`: the `sql()` + bind claim works on PostgreSQL;
  - two concurrent creates get two different consecutive numbers;
  - a create whose audit row fails rolls back, and its number is issued again, so numbering is gap-free.
- **Audit and ownership:**
  - the NC's CREATE audit row is in A's trail;
  - an NC naming B's device gets 404;
  - A-62: a CAPA approval records the caller, not the id in the body;
  - the CAPA carries CREATE then APPROVE audit rows;
  - a CAPA assigned to B's user gets 404;
  - A's list holds its own 4 NCs, with the device joined.
- **Tenant B:**
  - B's numbering is its own (`NC-00001`);
  - B lists only its own NC;
  - B updating A's NC is 404, and so is B raising a CAPA on A's NC;
  - B lists none of A's CAPAs;
  - A's NC is unchanged.

**The auditCoverage guard learned class-instance `.ts`.** After the workflow swap, `auditCoverage.p611` could not see `workflow.service.ts`, and it could not see `iot.service.ts` either:

- it recognised only `module.exports = new X`;
- it needed a method's parameters on one line.

The P6-11 lane, which owns the guard, applied my proposed patch with bite tests: `export = new X`, `export = x` with `const x = new X(…)`, and multi-line method heads. The gate (a) plant above was run against the patched guard.

## risk, supplierScorecard, vendor (standard method)

- **Suites.** 64 suites passed 2,904 tests, including `crudAudit.a278` (the A-278 behaviour check), `vendor.notes.q52` and the three `*.twoTenant*` suites. All three modules are at 100%.
- **The 3 failures are not mine:** `D-20 … calibration_records / stock_adjustments / stock_transfers .api_key_id`, the Q-51 migration's leading indexes (0105), from another lane.

## The stock opname audit (P6-11 gap, coordinator)

**What changed.**

- `stock#createOpname` and `#updateOpnameStatus` now each write ONE audit row in their transaction:
  - `createOpname` writes CREATE with the warehouse, status and schedule;
  - `updateOpnameStatus` writes UPDATE with the status and `completedAt` before and after.
- The actor is `auditPrincipal(req)` (user id, IP, user agent) with the performing user. An opname refuses an API key at the route (Q-51, `denyApiKey`).
- `stock.controller.js` passes `auditPrincipal(req)`.
- `updateOpnameStatus`'s unread fourth parameter is now read (`userId`).
- Both KNOWN GAP entries were removed from `tests/guards/auditCoverage.p611.test.ts`. That emptied the category, so its now-unused `KNOWN_GAP` constant was removed (typecheck `noUnusedLocals`), with a comment saying the list is closed.

**Evidence.**

- Fail-before: `tests/routes/stock.opnameAudit.p611.test.ts`, on memoryDb, **3/3 failed** before and 3/3 pass after. It checks that each write commits one audit row in its own transaction, and that a failed audit row rolls the status back.
- `stock.controller.test.js`: the two opname call assertions now include the actor.
- 28 stock suites: 514 passed, `stock.service.ts` at 100%.

## ADR-111 — the Stripe key boot guard (coordinator, alongside P9-16)

**Decision:** the main session decided it under the owner's delegation, from the gitleaks triage. The ADR is written in `MEMORY/DECISIONS.md` as ADR-111.

**What changed.**

- **New `src/config/billing.ts`**, which reads the environment through `config/env.ts`:
  - `billingEnabled()`: `BILLING_ENABLED=true|false` decides; unset, billing is enabled when `STRIPE_WEBHOOK_SECRET` is set;
  - `stripeSecretKey()`: the key; or, in production with billing enabled, an error naming `STRIPE_SECRET_KEY`; or the placeholder elsewhere;
  - `STRIPE_KEY_PLACEHOLDER`.
- **`stripeWebhook.service.ts`** takes its key from `stripeSecretKey()` at load. The boot reaches this module through the billing routes, so the refusal stops the boot, as the CERT_SIGNING_SECRET guard does.
- **`scripts/load-check.ts`** gives its production child a random `STRIPE_SECRET_KEY`, as it does the other required secrets. The lead asked for this so that the load gate never depends on a developer's `.env`.
- **`backend/.env.example`** documents `BILLING_ENABLED`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- **Not changed:** the gitleaks allowlist entry `sk_test_placeholder`. It is path-independent, and the literal now lives in `config/billing.ts`.

**Evidence.**

- `tests/services/stripeSecretKey.adr111.test.ts` loads the real module per case in an isolated registry:
  - 3 refusals: flag on with no key; a blank key; no flag but a webhook secret set;
  - 5 cases that still start: production with the key; production with billing off; `BILLING_ENABLED=false` with a webhook secret; development; test.
- **Fail-before, run twice:** against the old `envOr(..., "sk_test_placeholder")` line, 3 of 8 failed (every refusal case). After the change, 8/8.
- Every stripeWebhook suite passes: 78 tests.
- `npm run load:check` is OK in both modes, and also with `BILLING_ENABLED=true` in the parent environment.

## A-319 addendum

The A-319 sweep missed one CSV consumer: the legacy `backend/__tests__/reporting.service.test.js`. The leaf helper and the coordinator flagged it red. All 12 of its expectations now match A-319's intended format (every field quoted, CRLF records), with A-319 cited in the file. It passes 12/12.

## A-330 — the vendor search is case-insensitive (its own change, after the conversion)

**What changed.** `vendor.service.ts#fetchVendors` now matches `find` with `Op.iLike` on the term as typed, as A-320 did for warehouse, stock, ticket and tenant.

**Evidence.**

- Fail-before: `tests/routes/vendor.searchCase.a330.test.ts` on memoryDb, which evaluates `Op.like` case-sensitively and `Op.iLike` case-insensitively, as PostgreSQL does. It failed 3 of 5 before and passes 5 of 5 after.
- `vendor.service.test.js`: its sequelize mock gained `iLike`.
- 42 vendor suites passed 1,397 tests, and `vendor.service.ts` is at 100%.
- The A-330 row in AUDIT-2026-09-REMEDIATION is DONE.

## D-20 reconciled with ADR-100 Amendment 3

**What changed.**

- The AM-3 guard's migration reader moved, unchanged, to `src/tests/fixtures/migrationScan.ts`. `modelIndexColumns.am3.guard.test.ts` imports it: 8/8, and its diff is the import plus a pointer comment. The security-followups lane, which owns the guard, and the lead both agreed.
- The reader also collects the indexes the migrations create and drop.
- D-20's check (`0067-foreign-key-and-tenant-indexes.test.js`) accepts an FK index a migration creates, read from the migrations instead of a hand list. Partial indexes and indexes a later migration drops do not count.
- No model index was re-added.

**Bites.** An FK indexed nowhere fails, and so does one with only a partial, `down`-only or later-dropped index.

**Results.** 342/342, and 855 tests across the migration suites.

**Recorded** as the D-20 addendum in `TASKS/AUDIT-2026-09-DATA.md`.

## Gates at the end of the round

- **`npm run typecheck`:** green (0 errors).
- **`npm run build:dist`:** green (363 `.ts` compiled after ADR-111; contracts 19).
- **`npm run load:check`:** OK in both modes (dist via node, src via tsx).
- **`npm run ratchet`:** floor lowered to 884. `backend/.ts-ratchet.json` must be committed with these deletions.
- **Lint:** `npx eslint` reports no errors on every changed file.
- **Full gate:** not run on a quiet tree.

## Findings

- **A-330 (open):** `vendor.service#fetchVendors` searches with a case-sensitive `LIKE`. It is the A-320 defect at one more site, kept as built.
- **For the Q-51 owner (not a row):** D-20 reports three `api_key_id` columns without a leading index.

## For the ADR-087 amendment (for the lead to merge)

> **P9-16 (services helper), 2026-09-30.**
> - **Converted:** `workflow`, `qms`, `risk`, `supplierScorecard` and `vendor`, under Amendment 13's pattern. `workflow.service.d.ts` was retired.
> - **Identity:** 3,163 checks. Every difference is the accepted `Function.name`. All 20 applied plants were caught.
> - **A class instance converts as the instance.** `export =` of `new X()` with the `.js`'s added own properties assigned in order. Internal calls stay `this.x`. A lazily required still-JS dependency is typed locally by the members called (no `.d.ts` in another lane's directory).
> - **`this.x` at a CommonJS module's top level is `module.exports.x`.** It converts to a call through the exported object.
> - **Raw SQL with `replacements` moves to `sql()` first, in its own change** (qms `claimNumber`): 5 test doubles updated, fail-before 21/871.
> - **workflow and qms passed the four gates.** Guards bite on the `.ts` (d12, d24, d05, p611). The live PostgreSQL 18.6 checks as `callibrator_app` passed: workflow 27/27, including ADR-101 SoD and the A-183 gates; qms 20/20, including the bound counter claim.
> - **auditCoverage.p611 now reads class-instance `.ts` and multi-line method heads** (P6-11 lane, from this card's finding). Without that, a converted class service left the guard silently.
