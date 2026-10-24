# P30-01: the runbook names the built reconciliation and data-quality routes

**Date:** 2026-10-24 · **Card:** P30-01 (draft, updated) · **Status:** DRAFT — the run is P30-02, which waits on Phase 25 · **Spec refs:** `docs/UPSTREAM/05` § 7 (R-1 … R-12), `docs/UPSTREAM/03` § 7 (Q-findings), `docs/UPSTREAM/05` § 8 (the checklist the runbook follows)

## Hook

P25-01 and P25-02 are PARTIAL mechanisms — the reconciliation and the data-quality report, proven
on synthetic data, with eight checks and three findings still `manual` (ADR-129 Am. 11). The runbook (P30-01, DRAFT since 2026-10-23) told the
operator to "repeat until the reconciliation is green" without naming **how**. A runbook that
names no route sends the operator to the wrong console at 2 a.m. So the runbook now names both
routes, what each answers, and where each lives — and still marks itself DRAFT, because the run
itself waits on real data.

## Review correction (2026-10-24, same day)

The first version of this record and of the runbook said P25-01/P25-02 were DONE, that the
quarantine review was "per facility", and that the run-level checks were "RC-F1 … RC-F5". None of
that holds: both cards are PARTIAL, quarantine groups are complete only in the run totals, and
RC-F4 is `manual`. The runbook's header, step 5 and step 7 now say so, and step 7 adds that every
`manual` check is recorded by hand in P25-04 before the reconciliation counts as green.

## What changed

| | |
|---|---|
| [`TASKS/RUNBOOK-UPSTREAM-CUTOVER.md`](../../TASKS/RUNBOOK-UPSTREAM-CUTOVER.md) | Header: the mechanisms P25-01/P25-02 DONE 2026-10-24, tested on synthetic data; what is not proved unchanged (timings on real volumes, P24-05). Step 5: the quarantine review **is** `GET …/:id/data-quality` (P25-02) — every quarantined row by source table and reason, per facility, with run-level totals. Step 7: the reconciliation **is** `GET …/:id/reconciliation` (P25-01) — R-1/R-2/R-7 per facility, R-10/R-11/RC-F1 … RC-F5 at the run level |

No command, sequence or rollback changed. The runbook's honesty stands: it still says what is
not proved, and it still does not claim the run.

## Tests

Docs only; nothing to run. Traceability:

- both routes exist (`backend/src/routes/api/admin.route.ts`: `/upstream-sql-imports/:id/reconciliation`, `/upstream-sql-imports/:id/data-quality`), both super admin only, both contracted in `admin.openapi.ts`;
- both mechanisms are PARTIAL with records (`2026-10-24-p25-01-reconciliation-automated.md`, `2026-10-24-p25-02-data-quality-report.md`);
- the runbook names no value, only routes and counts.

- **Not run:** nothing. No code, route, migration or test changed.

## Definition of Done

- [x] the runbook names the reconciliation and data-quality routes with what each answers
- [x] the DRAFT status and the "what is not proved" section stand — the run still waits on real data
- [x] no real upstream value in the file

## Files

- `TASKS/RUNBOOK-UPSTREAM-CUTOVER.md`
- `TASKS/PHASE-30-UPSTREAM-CUTOVER.md`, this record
