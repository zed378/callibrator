# 01 — CI/CD

**Current state: CI is deferred.** The gates run locally, in git hooks and in the Makefile.

That is a deliberate, recorded decision — and it carries a real risk, stated below.

---

## The Risk of Deferring CI

Skipping CI would have silently returned the **zero-tolerance IDOR rule to being a sentence in a document**: its enforcement script had no caller other than a pipeline that did not exist.

That is the general failure mode of deferred CI. A gate with no runner is not a gate; it is a file.

The mitigation is that the gates were moved into `pre-push` rather than left orphaned, and `make verify` runs the same set. The residual risk is that a local hook can be bypassed with `--no-verify`, and a pipeline cannot.

## The Gates

Whatever runs them, these are the gates:

| Gate | Command |
|---|---|
| Lint | `pnpm lint` — including the React Compiler rules, not disabled |
| Types | `pnpm typecheck` — frontend only; the backend is JavaScript (ADR-030) |
| Format | `prettier --check` |
| Unit tests | `pnpm test` at the coverage thresholds |
| Build | `pnpm build` |
| **Secret scan** | on the diff |
| **IDOR enforcement** | every new `:id` route has a two-tenant test |
| **Route-gate check** | every new route has a permission gate |
| Docker build | both images |
| Migrations | apply to a clean database **and verify the columns** |
| E2E | 51 live specs against a running server |
| Browser | Playwright, 71 tests |

### Two gates that do not exist yet, and should

**The route-gate check.** A new route with no `dynamicAccess` or `rbac` call works for everyone with a token, and nothing fails the build. This is the single most likely authorization defect in the codebase.

**Post-migration column verification.** A migration wrapped in a blanket `try/catch` is recorded as applied while doing nothing. Comparing expected columns against `information_schema` after migrating is the mechanical fix.

Both are in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

### The secret scanner works

On its first run it flagged the project's own JWT test fixture — which is exactly the kind of finding that proves a scanner is connected.

## Local Hooks

| Hook | Runs |
|---|---|
| `pre-commit` | format and lint on staged files |
| **`pre-push`** | the full gate set, including the IDOR enforcement script |

`scripts/verify.sh` runs the same thing on demand. On its first run it caught a formatting break that had **already been merged**.

`--no-verify` bypasses hooks. That is the gap a pipeline closes and a hook cannot.

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
frontend: npm install  →  next build  →  .next/standalone
```

**The backend build regenerates the OpenAPI spec first.** A build that skips it ships a spec describing the previous version, which is worse than shipping none.

**There is no `--frozen-lockfile`, because no lockfile is committed.** `.gitignore` excludes `pnpm-lock.yaml`, `package-lock.json` and `bun.lock`, so every build resolves transitive versions fresh — a build that silently resolves a different dependency version than the one tested is a build that ships something nobody tested, and that is the current state rather than a guarded-against one. Recorded as **W-11**; committing a lockfile is the fix.

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
