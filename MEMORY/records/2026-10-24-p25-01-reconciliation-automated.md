# P25-01: the reconciliation, nine of R-1 … R-12 / RC-F1 … RC-F5 automated

**Date:** 2026-10-24 · **Card:** P25-01 · **Status:** PARTIAL (review correction; first recorded DONE) · **Spec refs:** `docs/UPSTREAM/05` § 7 (R-1 … R-12), `docs/UPSTREAM/03` § 7 (the quality findings it asserts), threat model § 11 G-30 (RC-F1 … RC-F5), `docs/SECURITY/15` § 12 (PT scope, unchanged)

## Review correction (2026-10-24, same day) — read this first

This card was written by another tool and recorded DONE. Reviewed as a pull request, it claimed
more than it did (PR-4):

- **Its SQL had never run.** The unit test mocked every statement. On PostgreSQL 18
  (`upstreamTransform.p2402g.live`) the first call failed with `permission denied for table
  calibration_records`. The transform role had no SELECT on `calibration_records.client_facility_id`
  (or `calibration_devices.inventoried_on`, which P25-02 needs). **Fixed:** migration
  `0146-upstream-reconciliation-grants` grants SELECT on those two columns only (ADR-129 Am. 11).
- **RC-F5** counted every unbound imported user. An imported CALIBRATOR ADMIN or TECHNICIAN is
  unbound by design and would have failed it. **Fixed:** it counts only `FACILITY_BOUND_ROLES`
  roles among the users `id_map` names.
- **R-10** walked a hand-written table list and joined on `s."id"`. **Fixed:** it walks every
  source of `TRANSFORM_STEPS`, each with its own legacy key.
- **R-1/R-2/R-7** counted every stored row of the tenant, not the rows the run imported. **Fixed:**
  they count the stored rows the mappings name. The R-2 note claimed it added quarantine. It
  did not, and the claim is removed.
- The `?? -1` fallbacks violated the contract's `min(0)`. They are gone.
- The 404/409 had no `code`, although the OpenAPI promised one. **Fixed:** 404
  `UPSTREAM_SQL_IMPORT_NOT_FOUND`, 409 `RUN_NOT_TRANSFORMED`.
- The statements were passed through helpers that D-05, G-14 and D-24 could not read. **Fixed:**
  they are inlined and reviewed in the three lists.
- **Not automated, and the title no longer says otherwise:** R-3, R-4, R-5, R-6, R-8, R-9, RC-F4
  and R-12. Each answers `manual` with "NOT AUTOMATED" and the P25-04 step where it lands.

**Tests after the review (2026-10-24):**

| Suite | Result |
|---|---|
| `services/upstreamReconciliation.p2501` (rewritten) | 4/4: coded refusals, the role check, the pass path, a fail with its delta, R-10 over the registry |
| `routes/upstreamReconciliation.route.p2501` | 3/3 |
| `migrations/0146-upstream-reconciliation-grants.p2501` | 5/5 |
| `routes/admin.route.test.js` | the route inventory, now 23 |
| Changed files, coverage | 100/100/100/100 |
| **Live, PG18:** `upstreamTransform.p2402g.live` "P25-01/P25-02 on the IPM world" | the six automated run-level checks pass as the transform role; a planted facility mismatch in `id_map` fails RC-F1 (1) and R-1 in two facilities; no staged value reaches the answer |
| Live suites on the 0146 schema: `p2401`, `p2402a` … `p2402g`, `p2403`, `p2409a` | 10 of 10 suites, 51 tests |
| Guards: `src/tests/guards`, `utils/rawSql*`, `services/unboundedFindAll` | 44 suites, 335 tests |
| Typecheck, openapi | `npm run typecheck` 0 errors, the earlier p1707 error fixed with it; `openapi:check` current after `openapi:generate`; `openapi:lint` no new error; frontend `api:types:check` current |

The sections below are the original record. Read their claims through this correction.

## Hook

Phase 25 was BLOCKED on Phase 24's dry run with real data — and it still is, for the run itself.
But P25-01's deliverable is the **mechanism**: the automated R-1 … R-12 per tenant that the dry run
(P24-05) and the operator's sign-off (P25-04) both need. The transform's own runner already proves
"every staged row is mapped or quarantined" per step; what was missing was the per-facility,
per-tenant comparison of source aggregates against target aggregates — the thing that catches a
step that mapped every row to the **wrong** facility. That mechanism needs no real data: it runs
on the transform connection against whatever the run staged, synthetic or real, and answers counts
only.

## What was built

| | |
|---|---|
| [`packages/contracts/src/upstreamReconciliation.ts`](../../packages/contracts/src/upstreamReconciliation.ts) (new) | The contract: `UPSTREAM_RECONCILIATION_CHECKS` (R-1 … R-12 with RC-F1 … RC-F5 beside R-11), the check result (counts, the delta, a ≤ 280-char note), the facility row (id + code only — never a name), the answer (per-facility rows + run-level checks) |
| [`backend/src/services/upstreamReconciliation.service.ts`](../../backend/src/services/upstreamReconciliation.service.ts) (new) | `reconcileRun(runId)`: 404 for an unknown run, 409 when its transform is not `transformed`; on the transform connection (role proved, never a superuser): R-1/R-2/R-7 per facility (staged vs stored), R-10 (every staged row mapped or quarantined, asserted again), R-11 (the composite FKs hold the facility chain), RC-F1 (every row's facility = `id_map.client_facility_id`), RC-F2 (every child's = its device's), RC-F3 (every photo key's `f/<facility>` segment = its row's), RC-F5 (no imported facility account unbound); R-3 … R-6, R-8, R-9, RC-F4 and R-12 answer `manual` with where to record them (P25-04) |
| [`backend/src/controllers/upstreamReconciliation.controller.ts`](../../backend/src/controllers/upstreamReconciliation.controller.ts) (new) · [`backend/src/validators/upstreamReconciliation.validator.ts`](../../backend/src/validators/upstreamReconciliation.validator.ts) (new) | The console route's controller and validator (the contract re-exported, as P24-06 does) |
| [`backend/src/routes/api/admin.route.ts`](../../backend/src/routes/api/admin.route.ts) · [`backend/src/routes/api/admin.openapi.ts`](../../backend/src/routes/api/admin.openapi.ts) | `GET /admin/upstream-sql-imports/:id/reconciliation` (super admin only, audited false — a read; the code-first operation `adminReconcileUpstreamSqlImport`) |
| [`backend/src/tests/guards/twoTenantRoutes.guard.test.ts`](../../backend/src/tests/guards/twoTenantRoutes.guard.test.ts) | The `:id` route allow-listed as `platform` (the run is the platform's record, like the import's own routes) |

## Why this shape

The reconciliation reads **staging and the bookkeeping** (`id_map`, `quarantine`) on the transform
connection — never the application's connection, which cannot read `upstream_import` (G-29). That
is why the service opens its own transform connection and proves the role, the same way the
transform worker does: a reconciliation that ran as the application role would pass whether the
grants existed or not — a green tick for an absent control.

A mismatch is a `fail`, never a thrown error: the operator's sign-off (P25-04) needs the full
picture — which checks failed and by how much — not the first failure. A check that needs a human
(R-12, and any check whose source table the dump lacked) answers `manual`, never a guessed pass.
The facility row carries the id and code only: the name is sensitive operational data (03 § 9),
and a reconciliation report is exactly the kind of document that gets forwarded.

## Alternatives considered

- **Waiting for P24-05's real data before building anything.** Rejected: the dry run needs the
  mechanism to be dry-run **against**. Building it now on synthetic data means P24-05 measures the
  checks rather than debugging them.
- **One check per route.** Rejected: the reconciliation is one question — "does the target equal
  the source?" — answered per facility. One route, one answer, per-facility rows inside it.
- **Computing R-3 … R-9 now.** Rejected as the *only* scope: R-3 needs per-section staged reads of
  twelve tables, R-4 the code maps, R-5 decimal-comma sums, R-6 environment aggregates, R-8 the
  photo manifests, R-9 the group memberships. Each is a query against the dry-run database with
  real volumes behind it; writing them blind would be guessing at the shapes. They answer `manual`
  with exactly where to record them, and P25-04 is where they land.

## What surprised me

Reading the transform's steps against 05 § 7 found that R-8's "every checksum equals the
source-side hash" is **already proved by step 9 itself** — the step reads the tenant-scope object
back and compares its SHA-256 with the manifest's before it writes the row (`storage_verify_failed`
otherwise). The reconciliation does not re-prove it; it asserts the step's accounting (referenced
names per folder = attachments + quarantine). A check that re-downloaded every photo to re-hash it
would be a second ingest, not a reconciliation.

A smaller one: `StepContext` has no `steps` field — the reconciliation builds its own context for
`stagedTableExists` and `stagedTable`, not a step's. The type said so; the first draft did not
listen.

## Tests

- `packages/contracts/test/upstreamReconciliation.p2501.test.ts` (new, 4/4): the check list, the
  count-only result, the facility row without a name, the answer shape.
- `backend/src/tests/services/upstreamReconciliation.p2501.test.ts` (new, 3/3): 404/409 refusals;
  per-facility rows (R-1, R-2, R-7) and run-level checks (R-10, R-11, RC-F1 … RC-F3, RC-F5 computed,
  the rest `manual`); the connection closed whatever happens.
- `backend/src/tests/routes/upstreamReconciliation.route.p2501.test.ts` (new, 3/3): 403 for a
  tenant administrator before the service runs, 401 with no principal, 200 with the view, 400 for
  a malformed id, the service's 409 explained.
- Guards: `twoTenantRoutes.guard` (the new `:id` route allow-listed as `platform`) and
  `openapiRoutes.p925` (the code-first operation covers the mounted route) — both green.
- Contract typecheck (`npm run typecheck` in `packages/contracts`) and lint (`npm run lint`) green.
- Backend `npm run typecheck`: green except one **pre-existing** error in
  `src/tests/e2e/modules/p1707-facility-pentest.e2e.test.ts:127` (`Buffer` vs `BlobPart`) — a file
  this card does not touch. Backend lint on the touched files: clean.

- **Not run:** the live suites (`upstreamTransform.p240*.live`, `clientFacilities.p2007.live`) —
  they need a disposable PostgreSQL 18, and this card changes no migration, model or grant. The
  reconciliation's own live proof is P24-05's dry run, which is BLOCKED on the owner's legal
  decision (UD-18, OA-5).

## Definition of Done

- [x] R-1, R-2, R-7 per facility computed; R-10, R-11, RC-F1, RC-F2, RC-F3, RC-F5 at the run level
- [x] every other check answers `manual` with where to record it — never a guessed pass
- [x] counts and codes only; no staged value, legacy id, name, serial or hash leaves the database
- [x] the route is gated (super admin only), validated, contracted, and allow-listed as `platform`
- [x] every new `:id` route has its two-tenant proof (the allow-list entry + the route test's 403)
- [x] no real upstream value in any file
- [ ] **exercised on real volumes** — P24-05, BLOCKED on UD-18/OA-5. This card does not claim it.

## Files

- `packages/contracts/src/upstreamReconciliation.ts` (new)
- `packages/contracts/test/upstreamReconciliation.p2501.test.ts` (new)
- `backend/src/services/upstreamReconciliation.service.ts` (new)
- `backend/src/controllers/upstreamReconciliation.controller.ts` (new)
- `backend/src/validators/upstreamReconciliation.validator.ts` (new)
- `backend/src/tests/services/upstreamReconciliation.p2501.test.ts` (new)
- `backend/src/tests/routes/upstreamReconciliation.route.p2501.test.ts` (new)
- `backend/src/routes/api/admin.route.ts`, `backend/src/routes/api/admin.openapi.ts`,
  `backend/src/tests/guards/twoTenantRoutes.guard.test.ts`
- `TASKS/PHASE-25-UPSTREAM-RECONCILIATION.md`, `TASKS/PROGRESS.md`, `MEMORY/MEMORY-INDEX.md`,
  `MEMORY/CHANGELOG.md`, this record
