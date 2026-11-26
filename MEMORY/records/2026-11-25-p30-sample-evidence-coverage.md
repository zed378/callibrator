# 2026-11-25 — P30-02 report sample evidence coverage

Status: fixed and verified in the working tree; no phase exit or cutover approval.
Spec refs: `MEMORY/specs/P30-02-rehearsal-evidence.md`,
`docs/UPSTREAM/05-DATA-MIGRATION.md` § 8, Phase 30 P30-02.

Review found a false-green in `scripts/upstream/cutover-evidence.mts`: a
nonempty sample could receive `automatedPass=true` with a field that compared
zero sessions, or with fewer sessions than the requested/population minimum.
The individual report schemas validate counts but do not enforce those relations.

The collector now requires each field's `compared` count to equal sampled
sessions; sessions must equal `min(requested, population)` and be nonempty.
Sample facility count must be nonzero and cannot exceed sampled sessions or
reconciled facilities. Output exposes only the aggregate `sampleMismatch` flag.
The existing counts-only output and `readyForCutover=false` boundary remain.

Named verification:

- `node --import tsx --test scripts/upstream/cutover-evidence.test.mts`:
  the two new negative regressions first failed against the original collector
  (8/10 passed). After the fix and a valid capped-sample positive control,
  **11/11 passed**. Cases cover zero/partial/excess field comparisons,
  truncated/excess sample sizes, impossible facility counts and a valid cap.
- Isolated strict TypeScript 7 no-emit check of collector, collector tests,
  archive rehearsal, PostgreSQL rollback rehearsal and retired-host HTTP check:
  exit 0 with NodeNext/ES2024, Node types and `allowImportingTsExtensions`.
- Existing `.tmp-p25-report.mts` read-only live retest on the synthetic
  `callibrator-p25-20261125` stack: **PASS**. All 16 fields compare all five
  sessions, zero differs (technician: three equal, two explained). Collector
  returns `automatedPass=true`, `sampleMismatch=false`, `readyForCutover=false`.
  Report durations: reconciliation 2063 ms, diff 226 ms, quality 818 ms.
  Initial sandbox request timed out; unrestricted local rerun succeeded.
- Targeted `git diff --check`: exit 0.

The existing archive, rollback and retired-host scripts were reviewed; they
were not modified or re-executed in this continuation. Their earlier records
retain their scope. No real upstream data, production endpoint, cutover,
destruction, owner signature or full repository gate is claimed.
