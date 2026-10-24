# P30-01: runbook re-verified — three stale check-count claims fixed

**Date:** 2026-10-24 · **Card:** P30-01 (draft, updated) · **Status:** DRAFT — the run is P30-02, which waits on Phase 25 · **Spec refs:** `docs/UPSTREAM/05` § 7 (R-1 … R-12), `docs/UPSTREAM/03` § 7 (Q-findings), `docs/UPSTREAM/05` § 8 (the checklist the runbook follows)

## Hook

The runbook was updated 2026-10-24 to name the built reconciliation and data-quality routes — but three rows still described the check set the way it looked **before** the P25-01/P25-02 review correction (ADR-129 Am. 11): "R-1 … R-11 per facility", "12 checks per facility", "the same R-1 … R-11 checks". None of that holds: only R-1/R-2/R-7 run per facility, five checks run at the run level, and eight answer `manual`. A runbook that overclaims automation sends the operator to the wrong console at 2 a.m. — the same failure mode the route-naming fix closed.

## Verification (no real data)

Read against the code, not the plan:

- `backend/src/services/upstreamReconciliation.service.ts` (header + `reconcileRun`): R-1, R-2, R-7 per facility; R-10, R-11, RC-F1, RC-F2, RC-F3, RC-F5 at the run level; R-3 … R-6, R-8, R-9, RC-F4, R-12 answer `manual`.
- `backend/src/services/upstreamDataQuality.service.ts` (header): quarantine groups + Q-12/Q-13/Q-18/Q-19 per facility; Q-4, Q-14, Q-28 and the orphan/file/user sections `manual`.
- `packages/contracts/src/upstreamReconciliation.ts` (`UPSTREAM_RECONCILIATION_CHECKS`): the 17-check vocabulary the `manual` answers use.
- `TASKS/PHASE-25-UPSTREAM-RECONCILIATION.md`: P25-01/P25-02 PARTIAL, P25-03/P25-04 BLOCKED on the dry run (P24-05, UD-18/OA-5).
- `docs/UPSTREAM/05-DATA-MIGRATION.md` § 7 (as-built note): the same PARTIAL split, "not automated … each answers `manual`".
- `TASKS/PHASE-26/27/28/29/31-UPSTREAM-*.md` + `docs/UPSTREAM/12-UAT-PLAN-ID.md`: re-read for the same drift — no check-count claims there; the UAT plan's § 3.2 line "(P24-02 masih berjalan, UD-7, UD-18)" is stale (P24-02 DONE 2026-10-13) but out of this card's scope, noted not fixed.

What was already correct and untouched: the header (P25-01/P25-02 PARTIAL, `manual` named), step 5 (data-quality route + run-level totals caveat), step 7 (reconciliation route + `manual`-by-hand caveat), the gates, the rollback, § 10, § 11.

## What changed

| | |
|---|---|
| [`TASKS/RUNBOOK-UPSTREAM-CUTOVER.md`](../../TASKS/RUNBOOK-UPSTREAM-CUTOVER.md) | T-0 row 6: "Reconciliation R-1 … R-11 per facility" → the built split (R-1/R-2/R-7 per facility; R-10/R-11/RC-F1/RC-F2/RC-F3/RC-F5 run level; R-3 … R-6, R-8, R-9, RC-F4, R-12 `manual` in P25-04). § 7 freeze-window row: "12 checks per facility" → 9 automated + 8 `manual`. § 8 dual-run: "the same R-1 … R-11 checks" → the same 9 + 8 `manual` |
| [`TASKS/PHASE-30-UPSTREAM-CUTOVER.md`](../../TASKS/PHASE-30-UPSTREAM-CUTOVER.md) | Status cell: notes this fix + record |

No command, sequence, gate or rollback changed. The runbook still says what is not proved, and still does not claim the run.

## Tests

Docs only; nothing to run. Traceability:

- the three rows now quote the service headers verbatim (check names, per-facility vs run-level, `manual` list);
- the runbook names no value, only routes and counts (privacy rule, Phase 12).

- **Not run:** nothing. No code, route, migration or test changed.

## Definition of Done

- [x] every check-count claim in the runbook matches the P25-01/P25-02 PARTIAL split (ADR-129 Am. 11)
- [x] the DRAFT status and the "what is not proved" section stand — the run still waits on real data
- [x] no real upstream value in the file
- [x] Phases 26–31 re-read: no other check-count drift found (one stale UAT-plan line noted, out of scope)
