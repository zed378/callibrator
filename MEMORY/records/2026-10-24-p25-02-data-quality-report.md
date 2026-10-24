# P25-02: the quarantine review and per-tenant data-quality report

**Date:** 2026-10-24 · **Card:** P25-02 · **Status:** DONE · **Spec refs:** `docs/UPSTREAM/05` § 7 (R-1 … R-12), `docs/UPSTREAM/03` § 7 (the Q-findings it names), threat model § 11 G-30 (RC-F5)

## Hook

P25-01 answers "does the target equal the source?" — counts of staged vs stored rows. What it does
not answer is "what did the transform **refuse**, and what does the refused pile say about the
source?" That is P25-02: the quarantine review (every quarantined row, by source table and reason,
per facility) and the data-quality report (the 03 § 7 findings as counts: duplicate serials,
orphans, implausible dates, files, users). Like P25-01 it needs no real data: it runs on the
transform connection against whatever the run staged, synthetic or real, and answers counts only.

## What was built

| | |
|---|---|
| [`packages/contracts/src/upstreamDataQuality.ts`](../../packages/contracts/src/upstreamDataQuality.ts) (new) | The contract: `UPSTREAM_DATA_QUALITY_SECTIONS` (quarantine, duplicates, orphans, dates, files, users), the quarantine group (source table, reason, rows), the finding (its 03 § 7 number, pass / flagged / manual, count, ≤ 280-char note), the facility row (id + code only — never a name), the answer (per-facility rows + run-level totals) |
| [`backend/src/services/upstreamDataQuality.service.ts`](../../backend/src/services/upstreamDataQuality.service.ts) (new) | `reportDataQuality(runId)`: 404 for an unknown run, 409 when its transform is not `transformed`; on the transform connection (role proved, never a superuser): quarantine by (facility, table, reason) with run-level totals; Q-18 duplicate serial groups per facility (flagged when > 0); Q-12 future dates and Q-13 pre-2023 dates (flagged when > 0); Q-4, Q-14, Q-28 answer `manual` with where to review them (P25-04) |
| [`backend/src/controllers/upstreamDataQuality.controller.ts`](../../backend/src/controllers/upstreamDataQuality.controller.ts) (new) · [`backend/src/validators/upstreamDataQuality.validator.ts`](../../backend/src/validators/upstreamDataQuality.validator.ts) (new) | The console route's controller and validator (the contract re-exported, as P24-06 does) |
| [`backend/src/routes/api/admin.route.ts`](../../backend/src/routes/api/admin.route.ts) · [`backend/src/routes/api/admin.openapi.ts`](../../backend/src/routes/api/admin.openapi.ts) | `GET /admin/upstream-sql-imports/:id/data-quality` (super admin only, audited false — a read; the code-first operation `adminReportUpstreamDataQuality`) |
| [`backend/src/tests/guards/twoTenantRoutes.guard.test.ts`](../../backend/src/tests/guards/twoTenantRoutes.guard.test.ts) | The `:id` route allow-listed as `platform` (the run is the platform's record, like the import's own routes) |

## Why this shape

The report reads **quarantine and the application's tables** on the transform connection — never
the application's connection, which cannot read `upstream_import` (G-29). That is why the service
opens its own transform connection and proves the role, the same way P25-01 and the transform
worker do: a report that ran as the application role would pass whether the grants existed or not
— a green tick for an absent control.

A finding the run cannot prove answers `manual`, never a guessed pass. Q-14 (calibration before
inventory) is plausible — calibrated before registration happens — so it is flagged for review,
not failed. Q-28 (files missing / unreferenced on disk) needs the manifests against a folder
listing on the dry-run machine, which is P25-04's job. The facility row carries the id and code
only: the name is sensitive operational data (03 § 9), and a data-quality report is exactly the
kind of document that gets forwarded.

## Alternatives considered

- **Waiting for P24-05's real data before building anything.** Rejected, as for P25-01: the dry
  run needs the mechanism to be dry-run **against**. Building it now on synthetic data means P24-05
  measures the quarantine rather than debugging the report.
- **One finding per route.** Rejected: the report is one question — "what did the transform refuse,
  and what does the source look like?" — answered per facility. One route, one answer, per-facility
  rows inside it.
- **Computing Q-19 (same serial across facilities) and Q-28 now.** Rejected as the *only* scope:
  Q-19 needs a cross-facility serial comparison with real volumes behind it, Q-28 a folder listing
  on the dry-run machine. They answer `manual` with exactly where to record them, and P25-04 is
  where they land.

## What surprised me

Reading the transform's steps against 03 § 7 found that Q-18's "oldest keeps the serial" is
**already the transform's rule** — step 8 NULLs the serial on the newer rows of a duplicate group
inside one facility (UD-9). The report does not re-decide it; it counts the groups so the operator
sees how much of the register arrived through that rule. A report that re-derived the survivor
would be a second transform, not a review.

A smaller one: the quarantine table has no facility column — the facility comes from `id_map`'s
`client_facility_id` for the quarantined row's source table and legacy id, where the transform
decided one. A quarantined row whose source never mapped (no device, no facility) lands in the
run-level totals only. That is honest: the transform never decided a facility for it.

## Tests

- `packages/contracts/test/upstreamDataQuality.p2502.test.ts` (new, 5/5): the sections, the
  quarantine group, the finding, the facility row without a name, the answer shape.
- `backend/src/tests/services/upstreamDataQuality.p2502.test.ts` (new, 3/3): 404/409 refusals;
  per-facility quarantine groups and findings (Q-18, Q-4, Q-12, Q-13, Q-14, Q-28), counts only;
  the connection closed whatever happens.
- `backend/src/tests/routes/upstreamDataQuality.route.p2502.test.ts` (new, 3/3): 403 for a
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
  report's own live proof is P24-05's dry run, which is BLOCKED on the owner's legal
  decision (UD-18, OA-5).

## Definition of Done

- [x] quarantine by (facility, table, reason) with run-level totals, codes only
- [x] Q-18, Q-12, Q-13 computed per facility; Q-4, Q-14, Q-28 answer `manual` with where to review them
- [x] counts and codes only; no staged value, legacy id, name, serial, room or hash leaves the database
- [x] the route is gated (super admin only), validated, contracted, and allow-listed as `platform`
- [x] every new `:id` route has its two-tenant proof (the allow-list entry + the route test's 403)
- [x] no real upstream value in any file
- [ ] **exercised on real volumes** — P24-05, BLOCKED on UD-18/OA-5. This card does not claim it.

## Files

- `packages/contracts/src/upstreamDataQuality.ts` (new)
- `packages/contracts/test/upstreamDataQuality.p2502.test.ts` (new)
- `backend/src/services/upstreamDataQuality.service.ts` (new)
- `backend/src/controllers/upstreamDataQuality.controller.ts` (new)
- `backend/src/validators/upstreamDataQuality.validator.ts` (new)
- `backend/src/tests/services/upstreamDataQuality.p2502.test.ts` (new)
- `backend/src/tests/routes/upstreamDataQuality.route.p2502.test.ts` (new)
- `backend/src/routes/api/admin.route.ts`, `backend/src/routes/api/admin.openapi.ts`,
  `backend/src/tests/guards/twoTenantRoutes.guard.test.ts`
- `TASKS/PHASE-25-UPSTREAM-RECONCILIATION.md`, `TASKS/PROGRESS.md`, `MEMORY/MEMORY-INDEX.md`,
  `MEMORY/CHANGELOG.md`, this record
