# The 2026-09-23 Audit Round: Seven Boards, 121 Findings, PostgreSQL 18 — 2026-09-23

**Kind:** change record, **written retroactively on 2026-09-27** (ADR-088). No record was written when
the work landed; this one is built from the commit and the boards it added, and claims nothing they
do not show.
**Commit:** `4c085ef` — "audit: seven boards, 121 new findings, PostgreSQL 18, and three adjudicated decisions"
**Decisions:** ADR-041 (PostgreSQL 18 is the baseline), ADR-042 (file serving), ADR-043 (fix the data, then retire the ladder)

## What It Was

An audit round, not a fix: **no application code changed** (the commit message says so, and its
diff touches only `TASKS/`, `MEMORY/DECISIONS.md`, `docs/`, two compose files and `deploy/README.md`).
Nine parallel agents, one area each, each required to cite `file:line` and to say what it did not check.

## Boards Added

| Board | Findings (per the commit message) |
|---|---|
| `TASKS/AUDIT-2026-09-DATA.md` | 29 — models, migrations, constraints, raw SQL |
| `TASKS/AUDIT-2026-09-INFRA.md` | 26 — storage, secrets, containers, deployment |
| `TASKS/AUDIT-2026-09-ASYNC.md` | 19 — workers, queues, schedulers, Redis, caching |
| `TASKS/AUDIT-2026-09-FRONTEND.md` | 17 — contracts, envelope, auth, error states |
| `TASKS/REVIEW-2026-09-23-REMEDIATION.md` | 17 — a review of the same day's remediation |
| `TASKS/DOCS-GAP-2026-09.md` | 17 — documentation, benchmarked against a reference repository |
| `TASKS/AUDIT-2026-09-AUTHZ-MATRIX.md` | 10 — all 389 routes and what authorizes each |
| `TASKS/AUDIT-2026-09-RECORDS.md` | 3 — the repository against its own records |

Also added: `TASKS/RUNBOOK-POSTGRES-18-UPGRADE.md`; the two compose files pinned to
`pgvector/pgvector:pg18` (ADR-041). **Nothing was upgraded** — the VM ran 17.11.

## The Findings the Commit Singled Out

D-01 (`bulkCreate`/`upsert` outside the tenant hooks), V-01 (every `rbac([TENANT_ADMIN])` route refused
every tenant admin), A-58 (`workflow` vs `workflows`), S-01 (`/uploads` public with sequential
certificate names), S-02 (restore recreated users without passwords), A-57 (the public verification
endpoint returned a draft certificate's PDF path), W-01, W-05, F-01. Their fixes are recorded in
[`2026-09-24-phase0-foundation-repairs.md`](./2026-09-24-phase0-foundation-repairs.md) and the batch
records after it.

## Corrections to the Repository's Own Records

From the commit message: counts re-derived — 71 models (not 72), 359 test files (not 342), 19
migrations, 40 ADRs; PHASE-3 P3-05 gained its A-47 defect block (this closed `RECORDS` R-01); A-34's lint
figure refreshed to 1,297.

## Evidence

Every claim above is from `git show 4c085ef` (message and `--stat`). **No test was run for this
round** — the commit states that the audit verified from code, and the RECORDS board records that
no `jest` run was performed.

## Why It Was Missing

The CLAUDE.md workflow requires a record per change; this round was committed with the evidence in
the boards and the commit body only. Found by the RECORDS sweep on 2026-09-27 (ADR-088).
