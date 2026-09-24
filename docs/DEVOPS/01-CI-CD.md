# 01 — CI/CD

**Current state: CI is deferred.** The gates run locally, in git hooks and in the Makefile.

That is a deliberate, recorded decision — and it carries a real risk, stated below.

---

## The Risk of Deferring CI

Skipping CI would have silently returned the **zero-tolerance IDOR rule to being a sentence in a document**: its enforcement script had no caller other than a pipeline that did not exist.

That is the general failure mode of deferred CI. A gate with no runner is not a gate; it is a file.

**⚠ Corrected 2026-09-21 — there is no `pre-push` hook.** The repository has no `.husky/`, no `lefthook`, no `simple-git-hooks`, no `core.hooksPath`, and `.git/hooks/` holds only git's samples. The IDOR enforcement script this card referred to does not exist either: `backend/scripts/` contains only documentation generators. The only gate runner is `make verify`, which a developer must remember to type — and which could not run on the Windows workstation where this repository is developed, because `make` is not installed there.

This document previously said the gates had been moved into `pre-push`. They were not. **There is currently no automatic gate of any kind** between a commit and `main`.

## The Gates

Whatever eventually runs them, these are the gates. **The "Exists" column is the point** — most are aspirations, and this table previously did not say so:

| Gate | Command | Exists? |
|---|---|---|
| Lint | `pnpm lint` — including the React Compiler rules, not disabled | yes (one pre-existing error in `GlobalSearch.tsx`) |
| Types | `pnpm typecheck` — frontend only; the backend is JavaScript (ADR-030) | yes |
| Format | `prettier --check` | config yes, no runner |
| Unit tests | `npm run test:coverage` at the 100% thresholds | **yes, passing** (backend 290 suites; frontend 70) |
| Build | `pnpm build` | yes |
| **Secret scan** | on the diff | **no** |
| **IDOR enforcement** | every new `:id` route has a two-tenant test | **no** — no script exists |
| **Route-gate check** | every new route has a permission gate | **no** — P6-04 |
| Docker build | both images | manual; both build |
| Migrations | apply to a clean database **and verify the columns** | apply yes, verify **no** |
| E2E | 53 live specs against a running server | yes, never green in one run |
| Browser | Playwright, 71 tests | **no — `automate/` is not in the repo** (U-07) |

### Two gates that do not exist yet, and should

**The route-gate check.** A new route with no `dynamicAccess` or `rbac` call works for everyone with a token, and nothing fails the build. This is the single most likely authorization defect in the codebase.

**Post-migration column verification.** A migration wrapped in a blanket `try/catch` is recorded as applied while doing nothing. Comparing expected columns against `information_schema` after migrating is the mechanical fix.

Both are in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

## Local Hooks — None Exist

**This section previously described a `pre-commit` hook, a `pre-push` hook running an IDOR enforcement script, and a `scripts/verify.sh`. None of them exists in this repository.** There is no hook tooling in any `package.json`, no `core.hooksPath`, no root `scripts/` directory, and no secret scanner. The text appears to have been carried over from a reference project's structure without being checked against this one — exactly the failure `CLAUDE.md` names as PR-4.

| Gate | Exists? |
|---|---|
| `pre-commit` hook | **no** |
| `pre-push` hook | **no** |
| IDOR enforcement script | **no** |
| Secret scanner (gitleaks or similar) | **no** |
| `scripts/verify.sh` | **no** |
| `make verify` | yes — manual, and `make` is not installed on the Windows development workstation |
| CI pipeline | **no** — P7-01 |

The honest summary: **nothing automatic stands between a commit and `main`.**

## The Coverage Gate Is Currently Failing

The backend unit suite runs against a **100%** threshold and is presently below it — the demo seeder, certificate submit-for-approval, `qms.validator`, the retention `legalHoldSchema`, the tenant subdomain-derivation branch and the param-merge branches all added uncovered code.

**A gate that is currently failing is a gate nobody trusts**, and it is the first item in [`../PLAN/16-IMPLEMENTATION-ROADMAP.md`](../PLAN/16-IMPLEMENTATION-ROADMAP.md).

Frontend gate: 70%.

## E2E Has Never Passed in One Run

Every fix has been verified live and **individually**. A single clean full-suite pass in one uninterrupted run has not been achieved, because the global rate-limit window kept needing to reset.

**That is a gap, not a pass.** Stating it plainly matters: an assertion that a suite passed is not evidence unless it passed as a suite.

Two operational rules for whatever runs it:

- **Never suspend the default tenant** — create a disposable one, or every subsequent request 403s.
- Give the rate limiter room, or expect failures unrelated to the code under test.

## Build Order Matters

```
backend:  npm run swagger:generate  →  pkg  →  dist/backend
frontend: npm ci --workspace frontend  →  next build  →  .next/standalone/frontend
```

**The backend build regenerates the OpenAPI spec first.** A build that skips it ships a spec describing the previous version, which is worse than shipping none.

**Both images install with `npm ci` against the committed root `package-lock.json`** (ADR-044): the backend since ADR-046 (S-13), the frontend since S-29. Each builds from the repository root (`docker build -f <workspace>/Dockerfile .`) because a workspace-directory context cannot see the root lockfile. *(This paragraph used to say no lockfile was committed — true before ADR-044, and the reason the frontend image ran `npm install` until S-29.)*

**The frontend ships Next.js standalone output on Node**, not a Bun-compiled binary. The compiled-binary path is still the intended on-premise format — see [`02-CONTAINERIZATION.md`](./02-CONTAINERIZATION.md).

## Turbo

```json
{ "tasks": {
    "build":     { "outputs": ["dist/**"], "cache": true },
    "test":      { "cache": true, "outputs": ["coverage/**"] },
    "typecheck": { "cache": true },
    "lint":      { "cache": true },
    "dev":       { "cache": false, "persistent": true }
}, "globalDependencies": ["**/.env.local", "**/.env"] }
```

Caching keys on `.env` files, so a configuration change correctly invalidates.

`typecheck` runs meaningfully only in `frontend/`.

## Images

Two, tagged by commit SHA and by semantic version.

**The same image is promoted through environments** — an image rebuilt for production is an image nobody tested.

The frontend is the exception by design: `NEXT_PUBLIC_*` values are inlined at build time, so a different API URL or a tenant-pinned build **requires** a different image.

## Migrations in the Pipeline

```
apply to a clean database
apply to a copy of production data
VERIFY THE COLUMNS in information_schema
confirm `down` exists and works
```

The verification step is not optional. A blanket-catch migration reports success and does nothing, and the failure surfaces weeks later as a missing-column runtime error.

## Deploying

```bash
make deploy-staging
make deploy-prod
```

See [`11-MAKEFILE-REFERENCE.md`](./11-MAKEFILE-REFERENCE.md). Rollback: [`08-ROLLBACK.md`](./08-ROLLBACK.md).

**Migrations run at backend boot.** On more than one replica, exactly one must run them, or two instances race.

## When CI Arrives

Suggested order, cheapest signal first:

```
1. lint · format · typecheck
2. unit tests + coverage
3. secret scan
4. IDOR enforcement · route-gate check
5. build both images
6. migrations against clean + production-shaped data, WITH column verification
7. E2E against a fresh stack           ← give the rate limiter room
8. browser suite
9. push images
```

Steps 3 and 4 are the ones a local hook can be bypassed around, and they are the two that guard the unwaivable security requirements ([`../SECURITY/00-SECURITY-REQUIREMENTS.md`](../SECURITY/00-SECURITY-REQUIREMENTS.md)).
