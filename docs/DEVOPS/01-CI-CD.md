# 01 — CI/CD

**Current state (2026-09-24): a GitHub Actions pipeline exists — [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — and has NOT YET RUN.** It was written in an environment with no GitHub runner and no Docker, so every stage below is *written*, and the parts that could be executed locally were (named per stage). The first run on GitHub is its first real test; expect it to find something, and record what (P7-01 DoD: *each stage is proved in the failing direction before the pipeline is trusted*).

A local, **opt-in** `pre-push` hook exists too (`make hooks`). The decision record is **ADR-PENDING-infra (CI)**, drafted in the batch-6 record.

---

## Why This Matters

Skipping CI would have silently returned the **zero-tolerance IDOR rule to being a sentence in a document**: its enforcement script had no caller other than a pipeline that did not exist. A gate with no runner is not a gate; it is a file.

Until 2026-09-24 there was **no automatic gate of any kind** between a commit and `main` (corrected 2026-09-21: the `pre-push` hook this document once described never existed).

## The Pipeline

Every job is a **required gate**. Nothing is `continue-on-error`, and nothing may become so to unblock a release — the abuse case P7-01 names. A stage that cannot currently pass is not softened; it is replaced by one that can fail honestly (the lint ratchet).

| Job | What it runs | Can it fail? — how that was checked locally |
|---|---|---|
| `secret-scan` | gitleaks 8.30.1 (sha256-verified) over **every commit** (`fetch-depth: 0`), config `.gitleaks.toml`, reviewed false positives in `.gitleaksignore` by fingerprint | yes — the repository's 41 commits scan clean; a scratch repository with a planted AWS key and a live-format Stripe key exits 1 with 4 findings |
| `workflow-lint` | actionlint 1.7.12 over `.github/workflows/` | yes — it caught a disallowed `env` context in this workflow's first draft |
| `backend-lint` | `node scripts/ci/eslint-ratchet.js` — fails when the backend ESLint **error count rises above** `backend/.eslint-baseline.json`, and when it falls without the baseline being lowered | yes — with the baseline set 4 below the real count it exits 1 and lists the files. Plain `eslint` cannot be the gate yet: ~1,100 errors (A-34), almost all formatting that P9-02a will `--fix` |
| `backend-test` | `npm run test:coverage` in `backend/` with the **100%** thresholds of `jest.config.js`; secrets are random per run | yes — jest exits non-zero below a threshold. **Includes the route-gate check** (`routePermissionGuard.p604.test.js`, P6-04) |
| `frontend` | `eslint` (errors fail), `tsc --noEmit` **directly**, `jest --ci`, `next build` | lint and typecheck run locally clean. The typecheck is deliberately NOT `turbo run typecheck`, which skips a package with no `typecheck` script and exits 0 — a gate that ran nothing |
| `dependency-audit` | `npm audit --audit-level=high` against the committed lockfile | yes — high/critical fail |
| `boot-and-migrate` | `pgvector/pgvector:pg18` (digest-pinned, the deployment's image), Redis and RabbitMQ service containers; boots `node index.js` with `NODE_ENV=production`, waits for `/health`; then `migrate:status` must list nothing; then a second boot must be healthy | boot runs `db.sync()`, **every migration**, then P6-05's schema verification, which **refuses the boot** on a column mismatch — so "healthy" means migrated end to end and verified against `information_schema` (this is `make migrate-verify`'s job, done mechanically). **Not run locally** (no RabbitMQ here) |
| `deploy-config` | `helm lint` + `helm template` for the default, staging and prod values, each validated with **kubeconform 0.7.0 against the Kubernetes 1.33 schemas**; the chart's guards asserted to **refuse** 7 bad configurations; `docker compose config -q` for all four overlays; dev overlay asserted to publish nothing on 0.0.0.0 but nginx | helm and kubeconform steps were run locally (helm 3.19 built from source): 14/14/11/12 resources valid, all 7 refusals refuse. **`docker compose config` was not run** — no Docker here; the compose files were validated against the compose-spec JSON schema instead |

Pinning: actions by commit SHA (tag in a comment); gitleaks, actionlint and kubeconform by version **and sha256**. Node is **24.21.0** in every job — the version both Dockerfiles build with; Node 22 fails the otplib ESM suites.

### What CI does not run yet — and why

| Not in CI | Why | Owner |
|---|---|---|
| backend typecheck | there is no backend `tsconfig.json`/`typecheck` script | P9-01a |
| plain `eslint` on the backend | ~1,100 errors; the ratchet stands in until they are fixed | P9-02a |
| format (`prettier --check`) | two conflicting Prettier configs govern `backend/` | P9-02 |
| live E2E (53 specs) | needs a seeded running stack and rate-limit headroom; **never passed in one uninterrupted run** | P6-02 |
| browser suite | `automate/` is not in the repository | U-07 |
| image build + push | "images pushed only from a green run" — a separate, later workflow that needs registry credentials | P7-01 remainder |
| IDOR enforcement script | still does not exist; the two-tenant tests run inside `backend-test` | — |

### Reproducible install (A-21)

Every job installs with `npm ci` against the committed root `package-lock.json`. A green run is therefore a run against the tree the tests were proven on.

### When the ratchet baseline must move

`backend/.eslint-baseline.json` holds the current error count. When a change **fixes** errors the ratchet fails until the baseline is lowered: `make lint-ratchet` shows the count, `node scripts/ci/eslint-ratchet.js --update` writes it — commit it in the same change. Raising it is the one thing a reviewer must refuse.

## The Local Hook — opt-in

```bash
make hooks        # git config core.hooksPath scripts/git-hooks
make hooks-off
git push --no-verify   # skip once; CI still runs everything
```

[`scripts/git-hooks/pre-push`](../../scripts/git-hooks/pre-push) runs, on what is about to be pushed only: **gitleaks over the pushed commits** (a secret stopped here never reaches the remote), the backend ESLint ratchet when `backend/` changed, the frontend typecheck when `frontend/` changed. It does not run the unit suites — CI does. A missing `gitleaks` is a loud skip, not a pass. Verified in a scratch repository: a pushed commit carrying an AWS key → exit 1; a clean range → exit 0.

It is opt-in on purpose: a hook forced on every clone is the first thing people learn to `--no-verify`, and CI is the gate.

## Secret Scanning — what the allowlist may contain

`.gitleaks.toml` keeps gitleaks' **default rules in full** and only adds allowlist entries, each narrow and commented: template placeholders (`CHANGE_ME…`, which `make check-env`/`make preflight` refuse at deploy time), the two env **templates**, test suites, and the lockfile's integrity hashes. **A real `.env` is not allowlisted — committing one fails the scan.** Five historical false positives (a password alphabet, doc examples, the `sk_test_placeholder` fallback) are silenced by **fingerprint** in `.gitleaksignore`, which silences exactly that finding in that commit: a new secret in the same file still fails. A new allowlist entry is a review item, like a new raw SQL query (abuse case: *the secret scan is allowlisted into uselessness*).

## The Gates

| Gate | Command | Runs where |
|---|---|---|
| Lint | frontend `eslint`; backend `make lint-ratchet` | CI · hook (backend) |
| Types | frontend `tsc --noEmit` — the backend is JavaScript until P9-01a | CI · hook |
| Format | `prettier --check` | **nowhere** — P9-02 |
| Unit tests | `npm run test:coverage` at the 100% thresholds | CI |
| Build | `next build` (frontend); `pkg` (backend, in the image) | CI (frontend) · manual images |
| Secret scan | gitleaks | CI (history) · hook (pushed range) · `make secret-scan` |
| IDOR enforcement | every new `:id` route has a two-tenant test | review only — no script |
| Route-gate check | `routePermissionGuard.p604.test.js` | CI (inside the unit suite) |
| Docker build | both images | manual |
| Migrations | boot on PG18 = apply + schema verification (P6-05) | CI |
| E2E | 53 live specs | manual — never green in one run |
| Browser | Playwright | **no** — U-07 |

## E2E Has Never Passed in One Run

Every fix has been verified live and **individually**. A single clean full-suite pass in one uninterrupted run has not been achieved, because the global rate-limit window kept needing to reset.

**That is a gap, not a pass.** Two operational rules for whatever runs it:

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

## Order, cheapest signal first

The jobs run in parallel; the order below is the order to read a red run in, and the order to add stages in:

```
1. secret scan · workflow lint              (seconds)
2. lint ratchet · frontend lint/typecheck
3. unit tests + coverage (+ route-gate check)
4. npm audit
5. boot on PG18: migrations + schema verification
6. helm render + schema + guards · compose config
7. [later] build images · E2E against a fresh stack · browser suite · push images from a green run
```

Steps 1 and the route-gate check are the ones a local hook can be bypassed around, and they guard the unwaivable security requirements ([`../SECURITY/00-SECURITY-REQUIREMENTS.md`](../SECURITY/00-SECURITY-REQUIREMENTS.md)).
