# A-21: The Lockfile Is Committed and npm Is the One Package Manager — 2026-09-23

**Kind:** change record, **written retroactively on 2026-09-27** (ADR-088), from the commit and the ADR
it added. No record was written at the time.
**Commit:** `f1caf6b` — "fix(phase-0): commit the lockfile and settle on one package manager (A-21, ADR-044)"
**Decision:** [ADR-044](../DECISIONS.md) — npm is the package manager, and its lockfile is committed

## What Changed (from `git show --stat f1caf6b`)

| File | Change |
|---|---|
| `.gitignore` | stops ignoring `package-lock.json`; nested `backend/` and `frontend/` lockfiles, `pnpm-lock.yaml` and `bun.lock` stay ignored |
| `package-lock.json` | committed (20,428 lines) |
| `Makefile` | every target uses npm; `make install` is `npm ci`; `make test-e2e` help text says 53 specs, not 51 |
| `MEMORY/DECISIONS.md` | ADR-044 |
| `TASKS/AUDIT-2026-09-REMEDIATION.md` | A-21 card |

## Why

`.gitignore` excluded all three lockfiles, so a clean clone resolved every floating range afresh. That
had already broken a gate: backend asked for `eslint ^10`, the root pinned 9.22.0, and the hoisted tree
enabled a rule the installed core lacked — ESLint crashed before linting a file (A-34), so `make verify`
could never pass. npm was chosen because the committed tree is the one the suite had been proven
against (the commit and ADR-044 state 6,128 tests); nothing had been verified under pnpm's layout.

## Left Deliberately

`pnpm-workspace.yaml` still existed and contradicted ADR-044; removing it was put to `TASKS/BACKLOG.md`
as an Open Question. The commit states it did not make `make verify` pass: lint was red at 1,297 errors,
and the backend had no typecheck task.

## Evidence

From the commit message and ADR-044 only. **No test run is recorded for this commit**; "6,128 tests"
is the figure ADR-044 cites for the tree it was proven against, not a run made for this change.
