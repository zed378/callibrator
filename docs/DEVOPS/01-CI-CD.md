# 01 — CI/CD

**Current state (2026-09-24): a GitHub Actions pipeline exists — [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — and has NOT YET RUN.** It was written in an environment with no GitHub runner and no Docker, so every stage below is *written*, and the parts that could be executed locally were (named per stage). The first run on GitHub is its first real test; expect it to find something, and record what (P7-01 DoD: *each stage is proved in the failing direction before the pipeline is trusted*).

**2026-09-25 follow-up (ADR-066):** with Docker available, the local half was re-run and found two stages that would have been red on the first GitHub run — `workflow-lint` (actionlint SC2086 on the workflow itself) and `secret-scan` (three findings in the repository's own documentation). Both are fixed. `backend-test`, `boot-and-migrate`, `dependency-audit` and `next build` have still not been run in their CI form, and **the workflow has still never run on GitHub**.

**2026-09-28 (ADR-082):** `backend-test`, `boot-and-migrate` and `dependency-audit` were run **in their CI form**: each job's `run:` steps verbatim, on an Ubuntu 24.04 stand-in with Node 26.10.0, a Linux checkout, and the workflow's own digest-pinned service images on a shared `localhost`. Three of them would have been red on the first GitHub run, and all three are fixed. `boot-and-migrate`'s `npm ci` ran under `NODE_ENV=production` and skipped `tsx`, which the boot needs (`--include=dev`). `migrate:status` never exited (M-13; `migrate.js` now closes the pool). `backend-test` failed its branch gate because coverage depended on `.env` (`maxFileSize.envFallback.p701`). All three now pass, and each was seen to fail once. **The workflow has still never run on GitHub.** Evidence: `MEMORY/records/2026-09-28-p7-01-02-03.md`.

A local, **opt-in** `pre-push` hook exists too (`make hooks`). The decision record is **[ADR-066](../../MEMORY/DECISIONS.md)**.

---

## Why This Matters

Skipping CI would have silently returned the **zero-tolerance IDOR rule to being a sentence in a document**: its enforcement script had no caller other than a pipeline that did not exist. A gate with no runner is not a gate; it is a file.

Until 2026-09-24 there was **no automatic gate of any kind** between a commit and `main` (corrected 2026-09-21: the `pre-push` hook this document once described never existed).

## The Pipeline

Every job is a **required gate**. Nothing is `continue-on-error`, and nothing may become so to unblock a release — the abuse case P7-01 names. A stage that cannot currently pass is not softened; it is replaced by one that can fail honestly (the lint ratchet).

| Job | What it runs | Can it fail? — how that was checked locally |
|---|---|---|
| `secret-scan` | gitleaks 8.30.1 (sha256-verified) over **every commit** (`fetch-depth: 0`), config `.gitleaks.toml`, reviewed false positives in `.gitleaksignore` by fingerprint | yes — **it failed on the repository's own commits on 2026-09-25** (three findings: this document and `.gitleaksignore` quoted the Stripe placeholder literally), and scans clean after three reviewed fingerprints (ADR-066); a scratch repository with a planted AWS key and a live-format Stripe key exits 1 with 4 findings |
| `workflow-lint` | actionlint 1.7.12 over `.github/workflows/` | yes — it caught a disallowed `env` context in this workflow's first draft, and on 2026-09-25 **it failed the committed workflow** (SC2086, five unquoted expansions in the helm steps); fixed with bash arrays |
| `backend-lint` | `node scripts/ci/eslint-ratchet.js` — fails when the backend ESLint **error count rises above** `backend/.eslint-baseline.json`, and when it falls without the baseline being lowered | yes — with the baseline set 4 below the real count it exits 1 and lists the files. Since 2026-09-28 (P9-02a, ADR-092) the count is **0** and so is the baseline: any new lint error fails. Plain `eslint` could now replace it; it has not yet (300 warnings remain, `no-unused-vars` is still a warning) |
| `backend-test` | `npm run test:coverage` in `backend/` with the **100%** thresholds of `jest.config.js`; secrets are random per run. **Since 2026-10-05 (ADR-117) a failure is readable without a token:** jest's `github-actions` reporter annotates each failing test, and `scripts/ci/jest-annotate.js` (on failure) annotates suites that never ran and every file below 100% — read them at `api.github.com/repos/zed378/callibrator/check-runs/<job id>/annotations` | yes — jest exits non-zero below a threshold. **Includes the route-gate check** (`routePermissionGuard.p604.test.js`, P6-04) — **run in CI form 2026-09-28** (ADR-082): 640 suites / 12,790 tests, 100% on all four; failed first on the branch gate (`.env`-dependent coverage), fixed |
| `frontend` | `eslint` (errors fail), `tsc --noEmit` **directly**, `jest --ci --coverage` (the coverage gate — plain `jest --ci` never evaluated it; corrected 2026-09-25, ADR-067), `next build` | lint (0 errors), typecheck and `npm test` (coverage gate: 42.01 / 36.56 / 35.65 / 42.32 against 41 / 35 / 34 / 41) run locally clean on 2026-09-25; `next build` not run. The typecheck is deliberately NOT `turbo run typecheck`, which skips a package with no `typecheck` script and exits 0 — a gate that ran nothing |
| `dependency-audit` | **Two gates since 2026-10-05 (ADR-117):** `npm audit --omit=dev --audit-level=high` — the production tree, no exceptions; then `node scripts/ci/npm-audit-gate.js` — the whole tree, where a high/critical advisory fails unless `scripts/ci/npm-audit-allowlist.json` excuses its GHSA id with an unexpired entry and the advisory is absent from the production tree | yes — high/critical fail — **run in CI form 2026-09-28**: 0 vulnerabilities, exit 0; with `lodash@4.17.20` in the lockfile, exit 1. 2026-10-05: red on GHSA-vfj7-8cjw-p6xm (`braces`, no fix, dev-only through Spectral and `eslint-config-next`); the gate fails on an expired entry, on an entry whose advisory reaches production, and on any unlisted id (saved-report cases in `MEMORY/records/2026-10-05-ci-second-run.md`) |
| `boot-and-migrate` | `pgvector/pgvector:pg18` (digest-pinned, the deployment's image), Redis and RabbitMQ service containers; boots `node --import tsx index.js` with `NODE_ENV=production`, waits for `/health`; then `migrate:status` must list nothing; then a second boot must be healthy | boot runs `db.sync()`, **every migration**, then P6-05's schema verification, which **refuses the boot** on a column mismatch — so "healthy" means migrated end to end and verified against `information_schema` (this is `make migrate-verify`'s job, done mechanically). **Run in CI form 2026-09-28** (ADR-082): healthy after 6 s, 63 migrations, `[schema-verify] OK: 72 tables, 867 columns`, nothing pending, second boot healthy after 4 s; a deleted `schema_migrations` row makes the pending step exit 1. It was red twice first (`tsx` not installed; `migrate:status` hung) |
| `live-db` | **Since 2026-10-08 (A-367, M-17):** every live database suite (`*.live.test.*`) against a `pgvector/pgvector:pg18` service (digest-pinned, the deployment's image) and a Mosquitto 2 broker started as a step (a service container cannot be given its no-auth configuration). `npm run test:live -- --with=mqtt` (`backend/scripts/live-suites.ts`) creates a fresh database per suite, sets the suite's opt-in variable, runs it, and drops the database: 36 runs over 35 files (`q34` in both modes). `liveSuites.a367.guard` (in `backend-test`) fails a live suite that is in neither of the runner's lists. Still by hand, each named in the runner with its reason: `upgradeBoot.am3`, `rabbitmq.w06`, `storage.s3.u09`, the three Redis suites | yes — **run locally in this form on 2026-10-08** (PostgreSQL 18.6, Mosquitto 2.1.2): the first full run exited 1 with 32 of 36 suites passing (four suites assumed a pre-built database or a stale count); after the repair 36 of 36. **Not yet run on GitHub** |
| `deploy-config` | `helm lint` + `helm template` for the default, staging and prod values, each validated with **kubeconform 0.7.0 against the Kubernetes 1.33 schemas**; the chart's guards asserted to **refuse** 7 bad configurations; `docker compose config -q` for all four overlays; dev overlay asserted to publish nothing on 0.0.0.0 but nginx | helm and kubeconform steps were run locally (helm 3.19 built from source): 14/14/11/12 resources valid, all 7 refusals refuse. **Re-run 2026-09-25 with Docker (ADR-066):** the helm and kubeconform steps verbatim in `alpine/helm` (helm **v4.3.0** — CI pins v3.19.0): same counts, all 7 refusals refuse; the compose step verbatim: all four overlays `config -q` exit 0; the S-19 check exits 0, and 1 with a Redis port forced onto 0.0.0.0 |

Pinning: actions by commit SHA (tag in a comment); gitleaks, actionlint and kubeconform by version **and sha256**. Node is **26.10.0** in every job (ADR-076) — the version both Dockerfiles build with; Node 22 fails the otplib ESM suites.

### What CI does not run yet — and why

| Not in CI | Why | Owner |
|---|---|---|
| plain `eslint` on the backend | the ratchet (`scripts/ci/eslint-ratchet.js`, baseline **0** since ADR-092) is the gate | P9-02a |
| format (`prettier --check`) | not wired as a CI stage | P9-02 |
| live E2E (57 specs) | needs a seeded running stack, Mailpit-read secrets and production request budgets a shared runner address exhausts; passed in one uninterrupted run, twice, by hand (P10-13, runs G and H) | P6-02 / A-19 |
| browser smoke and P10 browser suite | `automate/smoke.browser.js`, `automate/p10.browser.mts`: same reasons as the live E2E (mail, budgets) | ADR-077 / P10-13 |
| image push | CI holds no registry credentials. Since 2026-10-06 the images are pushed by hand to Docker Hub with `scripts/release/push-images.ps1` (clean tree, secret scan, `<sha>` + `latest`; ADR-123). "Images pushed only from a green run" is still a later workflow | P7-01 remainder / P7-09 |
| IDOR enforcement script | still does not exist; the two-tenant tests run inside `backend-test` | — |

CI runs the backend typecheck (job `backend-lint`) and, **since 2026-10-01, the browser accessibility suite** (`automate/a11y.browser.js`, job `browser-a11y`, M-14): axe WCAG 2.1 AA on the public and daily dashboard pages in both themes, the dialog focus contract, 200% reflow, reduced motion and the brand colour, against a disposable production-mode stack built from the commit with `deploy/compose/docker-compose.build.yml` beneath `docker-compose.e2e.yml` (the recipe the live E2E ran on; env from `scripts/ci/e2e-env.sh`). It runs on `main`, on manual dispatch and on pull requests touching `frontend/`, `automate/`, `deploy/compose/` or `packages/contracts/`; other pull requests report a skip. Record: `MEMORY/records/2026-10-01-p10-13-sso-a11y-ci.md`.

### Reproducible install (A-21)

Every job installs with `npm ci` against the committed root `package-lock.json`. A green run is therefore a run against the tree the tests were proven on.

### When the ratchet baseline must move

`backend/.eslint-baseline.json` holds the current error count. When a change **fixes** errors the ratchet fails until the baseline is lowered: `make lint-ratchet` shows the count, `node scripts/ci/eslint-ratchet.js --update` writes it — commit it in the same change. Raising it is the one thing a reviewer must refuse.

## The Local Hook — opt-in

```bash
make hooks        # git config core.hooksPath scripts/git-hooks, and installs the pinned gitleaks
make hooks-off
git push --no-verify   # skip once; CI still runs everything
```

[`scripts/git-hooks/pre-push`](../../scripts/git-hooks/pre-push) runs, on what is about to be pushed only: **gitleaks over the pushed commits** (a secret stopped here never reaches the remote), the backend ESLint ratchet when `backend/` changed, the frontend typecheck when `frontend/` changed. It does not run the unit suites — CI does. A missing `gitleaks` is a loud skip, not a pass. Verified in a scratch repository: a pushed commit carrying an AWS key → exit 1; a clean range → exit 0.

`make hooks` also runs [`scripts/git-hooks/install-gitleaks.sh`](../../scripts/git-hooks/install-gitleaks.sh) (A-19, ADR-076): it downloads gitleaks **8.30.1** — the version CI pins, with the release's own sha256 for linux, macOS and Windows (x64/arm64); the linux_x64 value is CI's — into the git-ignored `.tools/bin/`, verifies the checksum before installing anything, and is idempotent. The hook puts `.tools/bin` first on its `PATH`, so the hook and CI scan with the same binary. Without `make` (Windows without it): `git config core.hooksPath scripts/git-hooks && bash scripts/git-hooks/install-gitleaks.sh`. The frontend typecheck step runs `npm run typecheck` (TypeScript 7).

Tested by `backend/src/tests/guards/prePushHook.a19.test.js`, which runs the real hook in scratch repositories: a stubbed gitleaks finding refuses the push and scans exactly the pushed range; a clean push, a new branch, a delete and empty input; the loud skip with no gitleaks; and, with the real installed gitleaks, a generated AWS key in a pushed commit is refused and redacted.

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
| Docker build | all three images: backend and frontend in `browser-a11y` (the E2E stack, `docker-compose.build.yml`), the backup verifier FROM that backend in the same job (ADR-123); no push | CI (`main`, dispatch, PRs touching `frontend/`, `automate/`, `deploy/compose/`, `deploy/backup/`, `packages/contracts/`) · `push-images.ps1` for a release |
| Migrations | boot on PG18 = apply + schema verification (P6-05) | CI |
| E2E | 53 live specs | manual — never green in one run |
| Browser | puppeteer-core smoke (`make test-browser`) | **no** — needs a running stack (ADR-077) |

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

Three, published on Docker Hub as public repositories since 2026-10-06 (ADR-123): `zed378/calibration-be`, `zed378/calibration-fe` and `zed378/calibration-backup`. Each release is tagged with the **short commit** (7 characters) **and `latest`**. The default deployment tag is `latest`, the owner's choice; pin `IMAGE_TAG=<short commit>` (and optionally the per-image `*_DIGEST`) for a deployment that can be named and rolled back.

**Released by `scripts/release/push-images.ps1`**, from PowerShell or cmd, because Docker Desktop's credential store is not visible from Git Bash. The script:

- refuses a dirty tree;
- builds backend → frontend → backup (FROM that backend);
- secret-scans every image (file names, environment, `docker history`) before anything is pushed;
- pushes `<sha>` and `latest`;
- prints the digests in compose and Helm form.

`-DryRun` builds and scans only. `-ScanTag <tag>` re-scans existing images.

**The same image is promoted through environments** — an image rebuilt for production is an image nobody tested. Deployments **pull**: the base compose file and the vm, staging and prod overlays declare no build, and only `deploy/compose/docker-compose.build.yml` builds (dev, E2E).

The frontend is the exception by design: `NEXT_PUBLIC_*` values are inlined at build time, so a different API URL or a tenant-pinned build **requires** a different image. **`zed378/calibration-fe` is built for the reference deployment (`https://kalibrasi.zedth.my.id`) and serves no other URL.** Another deployment pushes its own frontend to its own repository (`-PublicUrl <url> -FrontendRepository <yours>`); the script refuses to put another URL into the reference repository.

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
7. build the three images (no push) · browser a11y suite on a disposable stack (`browser-a11y`)
8. [later] live E2E against a fresh stack · push images from a green run (today: by hand, `push-images.ps1`, ADR-123)
```

Steps 1 and the route-gate check are the ones a local hook can be bypassed around, and they guard the unwaivable security requirements ([`../SECURITY/00-SECURITY-REQUIREMENTS.md`](../SECURITY/00-SECURITY-REQUIREMENTS.md)).
