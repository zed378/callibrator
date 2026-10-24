# P29-04 review: the as-built modules doc gains Phase 25, and CLAUDE.md's stale gate rows are corrected

**Date:** 2026-10-24 · **Card:** P29-04 (DONE 2026-10-23; reviewed and extended) · **ADRs:** ADR-129 Am. 11, ADR-124 Am. 8 · **Spec refs:** `docs/BACKEND/13-UPSTREAM-MODULES.md`, CLAUDE.md § What Is Currently Failing

## Hook

`docs/BACKEND/13` was written the day before the P25 routes existed, and the day before the
pentest found that bindings had never worked on PostgreSQL. A map that is one day old and silent
on both is already wrong. CLAUDE.md still said the live suites "stay by hand" and quoted 37 skipped
suites, two weeks after the owner's no-skip rule removed them.

## What changed

| | |
|---|---|
| `docs/BACKEND/13-UPSTREAM-MODULES.md` | new **§ 10.1**: the reconciliation and the data-quality report, as built. It names the routes, the contracts, the services, migration 0146 and ADR-129 Am. 11, what is computed, what is `manual`, and the live proof. **§ 6**: the binding defect F-P1707-01 and its live test (ADR-124 Am. 8), the pentest result, and the route count. It said "eight routes" but `clientFacilities.route.ts` has nine; `/mine` was missing. **§ 11**: two controls added. **§ 12**: the gate and reconciliation state of 2026-10-24. **§ 13**: both ADR amendments |
| `CLAUDE.md` | **coverage row**: the 2026-10-05 figures (890 suites, 37 and 247 skipped) are replaced by the 2026-10-11 full run (1,025 suites, 17,473 tests, 0 skipped, 100% on all four; `records/2026-10-11-fix-guards-contract.md`). The no-skip rule and the scoped per-card gates are stated. **Live-suite row**: "stay by hand" and "not yet run on GitHub" are replaced by the 2026-10-10 `--with=all` run (55/55, 453 tests, 0 skipped; `records/2026-10-10-no-skip-live-suites.md`), today's count of 69 runs over 66 files, and the suites run today. **Commands**: `make test-e2e` now has 59 spec files, not 57. The section's refresh line names this correction |

Not changed, because nothing committed proves a newer state: the E2E row (the last full
uninterrupted pair is S/T on 2026-10-05), the CI row (the last named run is `5ba2865`), and the
Helm row.

## How the claims were checked

- Every route count in doc 13 was compared with its route file by counting `router.<verb>(` lines.
- The section 10.1 claims were compared with the services' code and with
  `upstreamTransform.p2402g.live`, run today.
- File counts: `find backend/src/tests/e2e -name "*.test.*"` gives 59. `find backend/src/tests -name "*.live.test.*"` gives 66. The `file:` entries in `scripts/live-suites.ts` give 69.

## Tests

Docs only. The evidence each sentence cites is a named record or a run from today (the P25-01
and P17-07 records).

## Files

- `docs/BACKEND/13-UPSTREAM-MODULES.md`
- `CLAUDE.md`
- `TASKS/PHASE-29-UPSTREAM-TRAINING-DOCS.md`
- `MEMORY/CHANGELOG.md`
- `MEMORY/MEMORY-INDEX.md`
- this record
