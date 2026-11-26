# 2026-11-25 — P28-03 / P30-02 cutover preparation

Working tree implementation; no upstream retirement, announcement, cutover or
invitation has been executed by these tools. No signature is inferred.
Spec: `MEMORY/specs/P30-02-rehearsal-evidence.md`; refs: upstream migration § 8,
ADR-138 Am. 1 G-2, Phase 28 and `TASKS/RUNBOOK-UPSTREAM-CUTOVER.md`.

## Implemented

- `deploy/compose/nginx/retired-upstream.conf.template` + HTML: complete old-host
  boundary, 410 for the old application/API/APK, no PHP proxy, legacy QR path
  retaining only the static rate-limited P27-02 notice. Privacy headers always.
- `TASKS/RUNBOOK-APK-RETIREMENT.md`: Indonesian announcement draft, operator
  rendering/deployment/verification steps, CDN/direct-origin checks, unsent APK
  drafts warning and fix-forward boundary. Nothing was sent or deployed.
- `scripts/upstream/cutover-evidence.mts`: sequential read-only collection of
  reconciliation, report diff and data-quality reports; shared-contract parsing,
  run/tenant agreement, every expected automated run/facility check required to
  pass, unique facility membership matching quality, a nonempty report sample,
  all report fields compared. Manual cannot replace an automated check.
  Output contains durations, aggregate counts and fixed check/field names only;
  notes, IDs, facility codes, source tables/reasons and tokens are omitted.
  The collector always emits `readyForCutover=false`, even on automated pass.
  HTTPS is required except loopback HTTP for disposable rehearsal, redirects are
  refused, output files are created exclusively, and failure logs omit bodies.

## Named verification

- `node --import tsx --test scripts/upstream/cutover-evidence.test.mts`: **8/8**.
  Independent fixtures prove manual work remains open, incomplete reports fail,
  inconsistent counts fail despite a server "pass", tenant/facility mismatch
  fails, empty samples fail, non-loopback HTTP receives no token and sensitive
  values never enter output.

- The report comparator now resolves a blank upstream `fullname` to the exact
  collision-resolved username held by the mapped account. The service query
  reads that username through the run's ID map and binds the provider tenant ID.
  `upstreamReportDiff.compare.p2503` plus `upstreamReportDiff.p2503`: **22/22**
  with coverage disabled for the focused run. The regression confirms a fallback
  technician is `explained` and passing, a different username is rejected, and
  the mapped-user join is tenant-bound. This resolves the synthetic report
  comparator discrepancy; it does not replace the separate report sample's
  observed technician variance or full rehearsal evidence.
- `node scripts/upstream/retired-upstream-check.mts`: **PASS** on a disposable
  nginx: syntax, GET/POST on `/api_v1/loginUser`, app/API/APK/PDF/debug paths
  return 410; privacy headers, fixed app sign-in link, legacy QR 200 notice,
  malformed QR 410 and private internal error document 404. The container and
  temporary directory were removed. First run asserted 410 for that internal
  document; nginx correctly gives 404, so the assertion was made explicit.
- `git diff --check` on the changed preparation files: exit 0.
- Isolated strict TypeScript 7 check of all three new scripts (`--ignoreConfig`,
  NodeNext/ES2024, Node types, no emit): exit 0. This is not the full repository
  typecheck or coverage gate.

- `node scripts/upstream/postgres-rollback-rehearsal.mts
  callibrator-p25-20261125-postgres-1 --synthetic-disposable`: **PASS twice**.
  Read-only dump of the synthetic target, restored into an owned clone; a
  pre-import custom-format backup of that clone (743,423 bytes), deliberate
  post-backup writes in the clone only, restore into a second fresh database.
  Independent original probe: 3 rows, SUM 37, MIN 1, MAX 3; post-backup table
  absent. Application counts match (4 tenants, 6 devices, 6 sessions, 94 audit
  rows), and staging schema remains. Second run proves public device read and
  staging SELECT refusal as `callibrator_app`. Backup 1,981 ms, restore 17,055 ms,
  total 63,716 ms. Both scratch databases removed; application DB untouched.
  Roles already existed in this cluster: this is not new-host recovery proof.
  Strict TypeScript 7 check including this fourth script: exit 0.

## Boundaries

The reconciliation agent also exercised the collector on its actual disposable
synthetic P21/P25 stack: all 17 check names and 16 report fields were present;
no reconciliation check failed, but the technician field differed for 1/5
sampled sessions. The collector correctly returned `automatedPass=false` and
`readyForCutover=false`. Transform time was 1,684 ms; report reads were 294 ms
(reconciliation), 130 ms (report diff), and 220 ms (data quality), 4 facilities,
15 quarantined rows and 18 flagged findings. These are synthetic component
measurements, not a freeze estimate. Investigation identified an empty-fullname
to username fallback discrepancy in the report comparator. The follow-up
[named retest](2026-11-25-p25-report-fallback-retest.md) rebuilt the binary and
compared all 16 fields across 5 sessions over HTTP: 0 differs, technician 3 equal
and 2 explained. The collector then returned `automatedPass=true` while
`readyForCutover=false`; operator requirements remain open.

P30-02 is not a completed full rehearsal: the actual production-volume
freeze/final delta and file timing still need evidence. The synthetic actual
application-schema PostgreSQL snapshot rollback boundary is now proven above;
the real target's pre-import backup and restore remain operator work.
Phase 31's synthetic MariaDB encrypted archive/restore proves a different
boundary and is not substituted for PostgreSQL rollback proof.
The owner's physical-device exclusion does not create a signed UAT or
reconciliation. Legal basis, security closure, invitations readiness,
go/no-go approval and production timings remain separate operator evidence.
