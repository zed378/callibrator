# 2026-11-25 — P25 report technician fallback regression

Scope: continue the synthetic rehearsal discrepancy investigation without a
production cutover. Spec refs: `TASKS/PHASE-25-UPSTREAM-RECONCILIATION.md`,
`docs/UPSTREAM/07-DATA-MINIMISATION.md` § 2.1 and § 3,
`MEMORY/specs/P30-02-rehearsal-evidence.md`.

The existing working-tree comparator fix reads the mapped account's exact
collision-resolved username when upstream `fullname` is blank. The `users`
join binds the provider tenant. A different username is still a discrepancy.

This continuation removed redundant test setup and normalized a missing query
username to `null`: the initial image build and backend typecheck exposed
TS2322 under `exactOptionalPropertyTypes` when the optional property was copied
as explicit `undefined`. The rebuilt production source compilation passed
after normalization (819 backend TypeScript files and 68 contracts files).

Named evidence:

- `upstreamReportDiff.compare.p2503.test.ts` and
  `upstreamReportDiff.p2503.test.ts`: **22/22**, after normalization; focused
  run uses `--coverage=false`, so no full coverage claim.
- Focused `git diff --check`: exit 0.
- Focused ESLint on the comparator, service and both named test files: exit 0
  after correcting the SQL assertion's quote style.
- Full backend typecheck after normalization found only errors in the parallel
  `notificationEmail.facility.p1707.test.ts` draft (reported to its owner);
  a green full-tree typecheck is not claimed here.

The dedicated `callibrator/backend:p25-report-20261125` image built successfully,
including `openapi:check`, production compilation and binary packaging. Only the
disposable P25 backend was recreated, retaining its synthetic database.

`.tmp-p25-report.mts` then made real HTTP calls to that binary at port 28130.
All 16 fields compared all 5 sessions across 3 sampled facilities: **0 differs**.
Technician: 3 equal, 2 explained, 0 differs. This supersedes the prior 1/5
technician discrepancy on this synthetic sample.

The same script ran `collectCutoverEvidence` at 2026-11-25T06:02:29.632Z:
`automatedPass=true`, `readyForCutover=false`; 4 facilities, no missing/failed
checks or fields, no incomplete facilities, no facility mismatch. Durations:
reconciliation 353 ms, report diff 138 ms, data quality 232 ms; original
transform duration 1,684 ms. It reports 15 quarantined rows and 18 flagged
findings. R-12 remains manual, along with the eight named operator evidence
requirements. These are synthetic timings, not a production freeze estimate.

No production approval, operator signature or full rehearsal completion is
inferred. The host sandbox initially refused tsx user-info access (ENOMEM);
the approved unsandboxed collector execution succeeded. No secret values were
printed or added to the repository.
