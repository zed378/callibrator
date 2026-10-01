# 2026-09-30 — A-319 to A-322 fixed: CSV injection, case-insensitive search, deleteStock atomicity, quota suspension

**Findings:** A-319, A-320, A-321 and A-322. The P9-15/P9-17 conversion found them ([record](2026-09-30-p9-15-17-warehouse-commercial-services.md)); the coordinator directed the fixes.
**Agent:** Phase 9 services helper.
**Method:** each fix is its own change on the converted `.ts` (or on the `.js` where the module is still JavaScript), and each has a fail-before test. No git writes were made.

## A-319 — CSV formula injection (security)

**What changed.** New file `backend/src/utils/csv.util.ts`, the one CSV writer. It exports `csvText`, `csvField`, `csvRecord` and `csvDocument`, and it has no `export =`.

- **RFC 4180.** Every field is quoted, `"` is doubled, and records end in CRLF.
- **OWASP neutralisation.** A cell starting with `=`, `+`, `-`, `@`, TAB or CR is prefixed with `'`. A plain number (`-5`, `-2.50`) is kept as-is, so quantities stay numbers.

Three callers now write through it:

- `stock.service#exportInventoryCsv`;
- `finance.service#getDepreciationReport`. Its serial number is now quoted, so a comma no longer shifts its row's columns;
- `reporting.service#toCsv`. Its own `csvEscape` rules moved into the helper. The leaf helper, which owns `reporting`, agreed; the change is limited to `toCsv`, and `export =` and the key order are unchanged.

I found no other backend CSV writer. The frontend only downloads the text the API returns.

**What differs for a consumer.**

- Every field is now quoted, headers included.
- The record separator is CRLF instead of LF.
- A header-only report still ends with one separator.

Spreadsheets read both forms. The two frontend download hooks only save the blob.

**Evidence.**

- Fail-before: `tests/services/csvInjection.a319.test.ts` failed 4 of 4 against the old services and passes 4 of 4 after. It parses each export with an RFC 4180 reader, checks every cell, and checks that the finance rows have 12 columns.
- The helper's cases are in `tests/utils/csv.util.a319.test.ts`. They are written by hand, not generated from the helper's own pattern.
- Re-pinned to the new form:
  - the `toCsv` assertions in `reporting.service.test.js` and `reporting.service.coverage.test.js`;
  - 1 assertion in `stock.service.test.js`.
- 22 suites that touch CSV: 412 tests passed.
- Coverage: `csv.util`, `stock`, `finance` and `reporting` are each at 100%.

**Addendum (same day).** The sweep missed one consumer: the legacy `backend/__tests__/reporting.service.test.js`, flagged red by the leaf helper. All 12 of its expectations now match A-319's format, with A-319 cited in the file, and it passes 12/12. Details are in `2026-09-30-p9-16-quality-services.md`.

## A-320 — the searches were case-sensitive

**What changed.** Four searches now use `Op.iLike` on the term as typed, instead of `%${term.toLowerCase()}%` under `Op.like`:

- `warehouse.service.ts`;
- `stock.service.ts`;
- `ticket.service.js` (`q`). Both agents with edits there, P6-11 and the correctness batch, released it first. Their edits are kept, including the `storedRichText` call;
- `tenant.service.js` (`find`). The P9-13 helper asked me to change it while it is still JavaScript and has taken the result as its identity baseline.

**Indexes.** A leading `%` rules out a b-tree index for LIKE and ILIKE alike, so no index use is lost. A `pg_trgm` GIN index would be the improvement; I did not add one.

**Evidence.**

- Fail-before: `tests/routes/search.caseInsensitive.a320.test.ts`. It runs through the real routers on memoryDb, which evaluates `Op.like` case-sensitively and `Op.iLike` case-insensitively, as PostgreSQL does. It failed 11 of 15 before; only the all-lower-case rows passed. It passes 15 of 15 after.
- Tenant: the coverage suite's search test pinned the defect ("a lowercased LIKE search"). I re-pinned it to `iLike`. It failed against the pre-fix code and passes after.
- `iLike` was added to the `sequelize` mocks of the ticket, warehouse and stock suites.
- 69 suites: 1,445 tests passed. The one failing suite is d24, on other agents' in-flight keys.

## A-321 — deleteStock soft-deleted outside its transaction

**What changed.** `deleteStock` now:

- sets `isDeleted` and saves with `{ hooks: false, transaction }`, P6-11's `deleteWarehouse` fix;
- writes a DELETE audit row in the same transaction;
- takes a third argument, `actor`. `stock.controller.js` passes `auditPrincipal(req)`.

I removed the `KNOWN GAP` entry for `services/stock.service#deleteStock` from `tests/guards/auditCoverage.p611.test.ts`, as the P6-11 lane asked.

**Evidence.**

- Fail-before: `tests/routes/stock.deleteInTransaction.a321.test.ts` failed 2 of 3 before and passes 3 of 3 after. It checks that the soft-delete and one audit row commit in one transaction, that a failed audit row rolls the delete back, and that a missing item is 404 with no write.
- Updated to the new call: the `deleteStock` tests in `stock.service.test.js` (`save` instead of `softDelete`; the audit row) and in `stock.controller.test.js` (the actor argument).
- Stock suites: 316 tests passed, and `stock.service.ts` is at 100%.

## A-322 — quota enforcement suspended every tenant (latent)

**What changed.** `meteredBilling.service#handleOverage` now decides paid or free from `Tenant.plan`: professional, business and enterprise are paid. The Stripe webhooks keep the plan in step with the subscription and set it to free when the subscription is deleted.

- **A paid plan** is logged and never suspended.
- **An ACTIVE free-plan tenant** is suspended by the new `suspendForQuota`, under ADR-094's marks:
  - the new constant `QUOTA_SUSPENSION_REASON` = `"billing:quota"` in `constants/tenantSuspension.ts`, and no `suspended_by`;
  - the `lifecycle_status` setting;
  - two audit rows, one under PLATFORM and one under the tenant (the A-165 rule), with the new system actor `system:usage-quota` (`SYSTEM_ACTORS.USAGE_QUOTA`, added to `a124`'s closed list);
  - all in one transaction that locks the tenant row and re-reads it.
- **A tenant that is not active** (operator-suspended, dunning-suspended or offboarded) is left as it is.
- A payment does not lift a quota suspension; `isDunningSuspension` still matches only `"billing:dunning"`.

**Alternatives considered.**

- **The `Subscription` row's status.** Rejected: `getSubscription` auto-creates a "basic" row, so a row existing does not mean the tenant pays.
- **Reusing `system:billing-webhook`.** Rejected: that actor names a Stripe event, and no Stripe event is involved here.
- **Removing the auto-suspend.** Rejected: the coordinator asked for the semantics to be fixed.

**The bad implication:** nothing lifts a quota suspension automatically. An operator reactivates the tenant through the lifecycle path. Nothing calls `enforceQuotas` today, so the whole path is still latent. **This is a decision, recorded by the lead as ADR-110** (from the text below).

**Shared file.** `meteredBilling.service.ts` was edited by the P6-11 lane at the same time (alert audit rows). I paused until it was done, then merged the import header into one value import of `Transaction` and used its top-level `auditService`. The P6-11 guard's `enforceQuotas` ALLOWED entry was removed, and the expected audited count for meteredBilling went from 2 to 3.

**Evidence.**

- Fail-before: `tests/services/meteredBilling.overage.a322.test.ts`, on memoryDb with the real audit service, failed 7 of 9 before (a business-plan tenant was suspended) and passes 9 of 9 after.
- `meteredBilling.service.test.js`: its two overage tests used the fictional `subscriptionId`. They now use `plan`, and the `db.transaction`, `TenantSettings` and audit mocks were added.
- 19 suites: 420 tests passed, and `meteredBilling.service.ts` is at 100%.

## Gates after all four

- **Lint.** `npx eslint` reports no errors on every changed file.
- **`npm run build:dist`:** green (348 `.ts` compiled).
- **`npm run load:check -- --src`:** OK. 532 modules were required, and 103 in boot order.
- **`npm run ratchet`:** at the floor, 898.
- **`npm run typecheck`:** two errors, neither in these files: `e2e/modules/p10-access-requests.e2e.test.ts:110` and `certificateDocument.snapshot.q50.test.ts:231`.
- **Full gate:** not run on a quiet tree. Other agents are mid-change.

## For an ADR (placed by the lead as ADR-110)

> **A-322 — who a quota overage may suspend.**
>
> **Decision.** Free vs paid is `Tenant.plan`. Only an active free-plan tenant is suspended, with suspension reason `billing:quota`, no `suspended_by`, and actor `system:usage-quota`. It is audited under PLATFORM and the tenant, in one locked transaction. A payment does not lift it; an operator does.
>
> **Alternatives.** The `Subscription` status (rejected: `getSubscription` auto-creates a "basic" row); the billing-webhook actor (rejected: no Stripe event); no auto-suspend (rejected: the coordinator asked for the semantics to be fixed).
>
> **Implications.** A free tenant suspended for quota stays suspended until an operator acts. Nothing calls `enforceQuotas` yet.
