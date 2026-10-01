# 2026-09-30 — P9-15 / P9-17: warehouse, stock, billing, finance, stripeWebhook and meteredBilling converted

**ADR:** ADR-087 (the amendment text is in the last section below; the Phase 9 lead merges it — it follows Amendment 13's module pattern).
**Cards (part):** P9-15 Warehouse (`warehouse`, `stock`) and P9-17 Commercial (`billing`, `meteredBilling`, `stripeWebhook`, `finance`). `quota` stays with the leaf helper.
**Agent:** Phase 9 services helper, assigned by the P9-12 lead.
**Tree:** HEAD `ce74932` plus other agents' uncommitted work. No git writes were made.

## What changed

| Card | File | Now |
|---|---|---|
| P9-15 | `services/warehouse.service.js` | `warehouse.service.ts` |
| P9-15 | `services/stock.service.js` | `stock.service.ts` |
| P9-17 | `services/billing.service.js` | `billing.service.ts` |
| P9-17 | `services/finance.service.js` | `finance.service.ts` |
| P9-17 | `services/stripeWebhook.service.js` | `stripeWebhook.service.ts` |
| P9-17 | `services/meteredBilling.service.js` | `meteredBilling.service.ts`, after the separate `sql()` change below |
| (new) | — | `services/webhook.service.d.ts` and `services/workflow.service.d.ts` beside the still-JavaScript modules stock imports |

Each `.js` was deleted only after `cmp` against its snapshot passed.

**Snapshots.** Each was taken after the other agent that had uncommitted changes in the file confirmed it was finished:

- P9-11 `validateInput` (the lead);
- A-276 / A-282 / A-305 / ADR-094 audit rows (security-followups);
- Q-51 `rowActor` / `apiKeyId` in stock (its sub-agent, which finished before the stock snapshot).

The `.d.ts` files were written only after the A-307 SSRF agent (`webhook.service.js`) and security-followups (`workflow.service.js`) confirmed they were done.

## The pattern (ADR-087 Amendment 13), as applied

- **Exports.** `export =` of one object in the original key order. `billing` keeps `STATUS_TRANSITIONS` between `updateSubscription` and `fetchInvoices`; `finance` keeps `computeDepreciation` last. No module has a named export beside `export =`. All six were loaded under `node --import tsx` with the expected keys: tsx/esbuild miscompiles a named export beside `export =`, which the typecheck does not catch.
- **Internal calls.** Every `exports.x` call now goes through the exported object, so a spy still intercepts it. This applies only to `meteredBilling`: `getAllUsage` → `getUsage`, `checkQuota` → `getUsage`, `enforceQuotas` → `checkQuota`, `generateUsageReport` / `getTenantUsage` → `getAllUsage`, and `getAnalytics` → `generateUsageReport`. The harness proves late binding for all of them.
  - `finance` calls `computeDepreciation` through the local binding, as the `.js` did.
  - `stripeWebhook` handlers call each other locally, as the `.js` did.
- **Load-time destructures are still load-time captures.** This covers models, `db`, `logger`, `AppError`, limits, schemas, `validateInput`, audit helpers (including Q-51 `rowActor`), `webhookService`, `WEBHOOK_EVENTS`, `SYSTEM_ACTORS`, `PLATFORM_TENANT_ID`, the dunning constants, `Transaction` and `sql`. `meteredBilling` still loads `circuitBreaker.util` at load time, as a side-effect import; the `.js` destructured `withCircuitBreaker` and never used it.
- **Lazy requires stay lazy.**
  - `stock` → `workflow.service` in `createTransfer` / `updateTransferStatus`, via a `loadWorkflowService()` helper. A plant that makes it eager is caught by the harness.
  - `stripeWebhook` → the `stripe` SDK, on the first verified event.
  - `meteredBilling` → the models barrel inside each function, via `loadModels()`.
- **Environment reads.**
  - `stripeWebhook` still reads `STRIPE_SECRET_KEY` (`envOr`) and `STRIPE_WEBHOOK_SECRET` (`env`) **once, at load**, and `NODE_ENV` per call (`isProduction()`).
  - `meteredBilling`'s three `USAGE_*` reads stay per call (`env`).
- **Still-JavaScript dependencies are imported through a `.d.ts` beside them.**
  - `webhook.service.d.ts` declares 18 keys; `emitAfterCommit` is typed.
  - `workflow.service.d.ts` declares a class instance: 13 prototype methods plus `RESOURCE_MENUS` and `CERTIFICATE_APPROVAL_NEEDS_REAUTH`. `startWorkflow` and `findPendingInstance` are typed.
  - All other members are `(...args: never[]) => unknown`.
  - `tests/guards/declarationDrift.p912.test.ts` holds both: 10/10 passed with them. `checkJs` is off, so no JavaScript caller is affected.
- **`db.Sequelize.Op`** (meteredBilling) is still read from `db` at call time (`opOf()`); the unit suites mock it there. `db` is handed to `sql()` as `dbRunner`, a load-time alias viewed as `SqlRunner`. It is an identifier, so d05's `sql(<identifier>,` scan still sees both statements.
- **Method.**
  - For `stock` onwards, the `.ts` was written and compiled in a scratch mirror of `src/`, then swapped in one step (`cp` .ts, `rm` .js), as the coordinator directed after the `meteredBilling` `.js`/`.ts` overlap blocked `build:dist`. That overlap lasted about an hour; it is closed.
  - Lint of the mirror file: `npx eslint --stdin --stdin-filename src/services/stock.service.ts`.

## Accepted differences

- **`Function.name`.** An `exports.x = async () =>` function had the name `""` and now has `"x"`, as accepted in Amendments 13 and 14. Every harness's single `module` difference is this and nothing else. `stripeWebhook` has no difference at all: its exports were already named.
- **`meteredBilling`'s `sql()` change** is a behaviour change, made as its own change (next section). It is not part of the conversion.

## The `meteredBilling` `sql()` change (its own change, before the conversion)

Under P9-07 a `sequelize.query` in `.ts` is a lint error, so both raw statements moved to `utils/sql.util#sql` in the `.js` first:

- the `getUsage` aggregate;
- the `resetUsage` DELETE.

Both already used `bind` and a `"tenantId" = $1` predicate.

**What differs.** `resetUsage`'s DELETE now runs with `type: "SELECT"`, because `sql()` always passes that. A DELETE without RETURNING resolves with no rows, and nothing reads them. `getUsage`'s options were already `{ bind, type: "SELECT" }`.

**The DELETE statement's quoting.** The statement is a single-quoted literal, the lint's `avoidEscape`, because a backtick with no interpolation fails `quotes`. d05's scanner reads a single-quoted literal whole and checks its bound predicate. The old escaped double-quoted string was read only up to the first `\"`.

**Test edit.** One assertion changed in `meteredBilling.service.test.js`: `resetUsage` now expects `{ type: "SELECT", bind: [...] }`.

**Fail-before.** Against the pre-change `.js` that suite failed 1 of 56 tests (that assertion). After the change it passed 56/56.

**Also passing:** d05 `rawSqlTenantPredicate` and `sql.util`. The file was at 100/100/100/100 before it converted. The post-change `.js` became the conversion's baseline snapshot.

## Identity evidence

**Method.** Each harness compared the working-copy `.js` snapshot against the compiled `.ts`:

- both loaded from one scratch tree, compiled by TypeScript 7 from `tsconfig.build.json`;
- the same recording fakes at the module boundary for both: the models barrel, `config` (`db` with a recording transaction), the activityLog logger, `audit.service`, `webhook.service`, `workflow.service` (a counting getter proves the require stays lazy), and a fake `stripe` SDK;
- a frozen clock;
- environment cases reloaded per case.

Each harness compares results, rejections, model calls, and the logger / audit / transaction / webhook / workflow logs.

**Bite tests.** Every harness was bitten by planted defects in the compiled output (`bite.sh`), and every plant that applied was caught.

| Module | Checks | Different | Plants caught | Scratch script |
|---|---|---|---|---|
| `warehouse` | 1,283 | 1 (names) | 5/5 | `p9com/cmp-warehouse.js` |
| `billing` | 13,254 | 1 (names) | 5/5 | `p9com/cmp-billing.js` |
| `finance` | 40,384 | 1 (names) | 5/5 | `p9com/cmp-finance.js` |
| `stripeWebhook` | 8,300 | 0 | 7/7 | `p9com/cmp-stripeWebhook.js` |
| `meteredBilling` | 4,416 | 1 (names) | 6/6 | `p9com/cmp-meteredBilling.js` |
| `stock` | 2,372 | 1 (names) | 5/5 (one plant did not apply) | `p9com/cmp-stock.js` |

The `stripeWebhook` harness first survived one plant: the `sk_test_placeholder` default. I added the environment case "secret set, key unset" and it then caught both of that plant's forms.

**What each harness covered:**

- **`warehouse`:** validation failures; 404/409/400 paths; commit and rollback failures; a thrown `null`.
- **`billing`:** every status transition × reason × actor (user, API key, system, `null`); the Stripe-managed 409; transaction and audit failures; limit/page edge cases.
- **`finance`:** a 4×8×6×8×6×4 `computeDepreciation` grid; revive of a soft-deleted row; CSV cells with quotes and commas.
- **`stripeWebhook`:**
  - six environment cases, including secrets changed after load;
  - every event type × tenant state (active, dunning-suspended, operator-suspended, offboarded, missing) × subscription status;
  - audit and transaction failures.
- **`meteredBilling`:**
  - four environment cases × six scenarios;
  - late binding for all five internal calls;
  - the unhandled `persistUsage` rejection path.
- **`stock`:**
  - every transfer status path, including the pending-workflow 409 and the destination-created branch;
  - Q-51 actors (user / API key / none);
  - the CSV export.

## Tests, coverage, lint, gates

Every suite that references a module was run after its swap. Test edits:

- the re-keyed d24 lines (`unboundedFindAll.d24.test.js`), each with the comment "P9-15/P9-17: the file is TypeScript (re-keyed, ADR-087)":
  - `warehouse` 1;
  - `finance` 1;
  - `meteredBilling` 3;
  - `stock` 2;
- the one `meteredBilling` assertion above.

| Module | Suites run | Tests passed | Coverage |
|---|---|---|---|
| `warehouse` + `billing` | 16 | 239 | 100/100/100/100 each |
| `finance` | 11 | 171 | 100/100/100/100 |
| `stripeWebhook` | 8 | 73 | 100/100/100/100 |
| `meteredBilling` | 12 | 254 | 100/100/100/100 |
| `stock` | 13, 2 of them skipped live suites | 213 | 100/100/100/100 |

**Results.**

- **Failures.** Each run's only failures were d24 keys of other agents' in-flight conversions: `signInPolicy`, `tenantBackup`, `tenantHierarchy` and `kanban`. My keys are all resolved.
- **`apiKeyActor.q51.test.ts`** (13 tests, Q-51's pin) passed after the stock swap.
- **Lint.** `npx eslint` reports 0 problems on all six `.ts` and both `.d.ts`.
- **`npm run build:dist`:** green after the last swap (203 `.js` copied, 340 `.ts` compiled).
- **`npm run ratchet`:** "902 .js file(s), at the floor". The floor was lowered with these deletions, so `backend/.ts-ratchet.json` must be committed with them.
- **`npm run typecheck`:** no error in these files. The two remaining errors are other agents' in-flight tests: `session.revoke.n01.test.ts:73` and `certificateDocument.snapshot.q50.test.ts:231`.

**The full gate has not been run on a quiet tree.** Nothing here claims it green.

## Findings recorded, not fixed (ADR-038 rule 3)

| Row | Finding |
|---|---|
| **A-319** | CSV formula injection in `stock#exportInventoryCsv` and `finance#getDepreciationReport`; finance also writes the serial number unquoted. `reporting.service#toCsv` already neutralises formulas. |
| **A-320** | The warehouse / stock / tenant / ticket searches lower-case the term under a case-sensitive `LIKE`. |
| **A-321** | `deleteStock` soft-deletes outside its transaction. P6-11 fixed `deleteWarehouse`'s identical shape the same day. |
| **A-322** | Latent: `meteredBilling#handleOverage` reads a `Tenant.subscriptionId` that does not exist, so `enforceQuotas` would suspend every over-quota tenant with no reason and no audit row. Nothing calls it today. |

**Also as built:** `warehouse`, `stock`, `billing` and `finance` lists answer `data: { rows, count, meta }`, which their controllers unwrap into the envelope, so the wire is correct. `billing` throws plain `{ status, message }` objects under a reasoned file-level `only-throw-error` exemption. Neither is a new row.

## Not done here

- `backend/.ts-ratchet.json`, `TASKS/PROGRESS.md`, the Phase 9 cards, `MEMORY-INDEX` and `CHANGELOG`: the lead's.
- **Scratch mirror.** It resolved packages through two directory junctions, one to `backend/node_modules` and one to the root `node_modules`. Both were removed with `cmd /c rmdir` once stock landed, and both real `node_modules` directories were checked afterwards. Anyone reusing the method should remove such junctions the same way: `rm -rf` follows a junction and deletes the target's contents.

## For the ADR-087 amendment (for the lead to merge)

> **P9-15 / P9-17 (services helper), 2026-09-30.**
> - **Converted, all under Amendment 13's pattern:** `warehouse`, `stock` (P9-15); `billing`, `finance`, `stripeWebhook` and `meteredBilling` (P9-17).
> - **Identity:** 70,009 checks against the working-copy `.js`. Every difference is the accepted `Function.name` of `exports.x =` functions. Each harness caught every plant that applied, 33 in all.
> - **Lazy requires stay lazy:** `stock` → `workflow.service`, `stripeWebhook` → the `stripe` SDK, `meteredBilling` → the models barrel. The harnesses prove each one.
> - **Load-time environment reads stay load-time:** `stripeWebhook`'s two secrets. `NODE_ENV` stays per call.
> - **Raw SQL moves to `sql()` in its own change, before the conversion:** `meteredBilling`'s two statements; one test assertion; fail-before 1/56.
> - **New `.d.ts` beside still-JS modules:** `webhook.service.d.ts` and `workflow.service.d.ts` (the second declares a class instance, prototype methods included). The typed members are the ones a converted caller uses; the rest are `(...args: never[]) => unknown`. `declarationDrift.p912` holds both.
> - **A swap is one step, and a named export beside `export =` is forbidden:** the `.ts` is built and proved in a scratch mirror of `src/`, then swapped in with the `.js` deleted, so `build:dist` never sees a `.js`/`.ts` pair. No named export sits beside `export =`: tsx/esbuild compiles one into an undefined reference that crashes at boot while the typecheck passes. Each module is loaded under `node --import tsx` after its swap.
> - **Findings recorded:** A-319 through A-322.
