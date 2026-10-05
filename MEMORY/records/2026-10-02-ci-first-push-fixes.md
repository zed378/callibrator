# 2026-10-02 — CI on the first push of `1100658`: three causes, reproduced on Linux, fixed

**Run:** GitHub Actions `ci` run 36954054620 on `1100658` (pushed to `origin/main`).
**Author:** CI-reproduction agent, for the main session. No commit or push was made by this agent.
**Written:** 2026-10-05 (the work began 2026-10-02 and was interrupted by a session restart).

## What failed

Job and step conclusions, read from the public jobs API (`/actions/runs/36954054620/jobs`; the logs need auth):

| Job | Failing step |
|---|---|
| backend unit + coverage gate (100%) | `npm run test:coverage` |
| boot on PostgreSQL 18 | Boot the backend |
| deploy config | docker compose config, every overlay |
| browser a11y | The stack's env file (random secrets, outside the checkout) |

Passed: actionlint, npm audit, API contract, backend lint, backend module load, gitleaks, frontend.

## How it was reproduced

A `node:26.10.0` (Debian) container, the `ci.yml` Node version. The tree was a `git clone` of a bundle of
`HEAD`, not `git archive`: on this workstation `core.autocrlf=true` makes `git archive` write CRLF, and the
first attempt failed `auditCoverage.p611` for that reason alone (its scanner splits on `\n`), a false lead.
A clone also gives the `.git` that `prePushHook.a19` needs, as `actions/checkout` does. `npm ci` ran inside the
container, as the unprivileged `node` user (the runner is not root). Then the job's own steps: `cp
backend/.env.example backend/.env`, seven random hex-32 secrets in the environment, `CI=true`, and
`npm run test:coverage -- --ci --forceExit` in `backend/`. No database or other service.

The first full run used all 16 host cores (15 jest workers). That adds failures CI does not have: SIGKILLed
workers (memory) and 10 s timeouts. The final run pinned the container to 4 CPUs (`docker update
--cpuset-cpus 0-3`), the size of a GitHub-hosted runner for a public repository.

## Cause 1 — the coverage gate: three suites depended on the workstation

Each one passes on the workstation and fails in a fresh Linux checkout built from `.env.example`.

| Suite | On Linux at `HEAD` | Why it passed on the workstation | Fix |
|---|---|---|---|
| `tests/services/alertRouting.p702.test.js` (2 cases) | the retention sweep's outcome is `failure`, alert key `job.retention-sweep.failed` instead of `.incomplete` | P10-05 added `runAccessRequestRetention()` to the scheduled sweep, and the test did not mock it: it opened a **real** `db.transaction`. The workstation's `backend/.env` points at a local PostgreSQL that answers; CI has no database, so the step failed and the sweep counted as failed | the test mocks `services/accessRequest.service#runAccessRequestRetention`, as its header already said it mocks the retention service's database work |
| `tests/routes/user.createSuperAdmin.dast.test.ts` (2 cases) | 400 `Validation Error`, `roleId: Invalid GUID`, instead of the 403 refusal | `.env.example` set `SUPER_ADMIN_ROLE_ID=uuid-here`. `constants/roleConstants.ts` reads it at load, so the super-admin role id became `uuid-here` and the request naming it failed the UUID validator. The workstation's `.env` leaves the variable unset (the default, the seeded id) | `.env.example` leaves it unset, with the reason. The id half of the super-admin checks (`user.service`) compared against a value no row can hold for anyone who copied the template; the name half (`isSuperAdminRoleName`) still refused, so nothing was granted. New guard `tests/config/envExampleRoleId.ci.test.ts`: fails on `HEAD`'s template (`["uuid-here"]`), passes after |
| `tests/services/gdpr.exportDecimals.q55.test.ts` | `ENOENT: open '/work/backend/exports/export-….zip'`; passes alone **only** if `backend/exports` exists | the test spied on `createWriteStream` of `import * as fs`, a namespace **copy**. The service's `import fs from "fs"` reads the real module, so the real `createWriteStream` ran: it wrote an empty ZIP into `backend/exports` (the workstation has such files, dated 2026-10-01), and on a fresh checkout without that directory it threw | the spy is on the real module object (`jest.requireActual("fs")`), and the test now asserts the double was called once. Re-run on Linux: passes, and no `backend/exports` is created |

## Cause 2 — boot on PostgreSQL 18: `ACCESS_REQUEST_IP_PEPPER` missing

Reproduced against throwaway `pgvector/pgvector:pg18`, `redis:8.6-alpine` and `rabbitmq:3.13-management-alpine`
containers (the digests `ci.yml` pins), the job's environment, `npm ci --include=dev` with `NODE_ENV=production`,
and `node --import tsx index.ts`. With the six secrets of `HEAD`'s workflow it exits at once:
`ACCESS_REQUEST_IP_PEPPER: is required in production (P10-05)` (`config/env.ts#validateEnvironment`). The
coordinator's working-tree fix adds it to both secret loops in `ci.yml`. With it: healthy after 23 s, 80
migrations applied, `migrate:status` shows nothing pending, the second boot is healthy after 8 s.

## Cause 3 — deploy config and browser a11y: `scripts/ci/e2e-env.sh` not executable

Committed as `100644`; both jobs run it directly, and bash answers `Permission denied`, exit 126 (reproduced in
the container). The coordinator's fix (`git update-index --chmod=+x`) is staged: `100755`. With it, the helm
lint/template/kubeconform loop, the seven refusal checks and the compose step (every overlay, the dev port
check, the e2e env file and service list) all pass, run with helm 3.19.0, kubeconform 0.7.0 and the step's
own commands. No other tracked shell script is run directly while non-executable (`install-gitleaks.sh` is run
through `bash`; `frontend/entrypoint.sh` is not in the image).

## Evidence

- Linux, `HEAD` + these fixes, 4 CPUs: `npm run test:coverage -- --ci --forceExit` **exit 0**: Test Suites
  **870 passed**, 36 skipped, 0 failed; Tests **14,859 passed**, 233 skipped; **All files 100 / 100 / 100 / 100**.
- Linux, `HEAD` unfixed (16 workers): 11 suites failed. Three are the causes above; the other eight were load
  (SIGKILL, 10 s timeouts) and did not recur at 4 CPUs.
- Windows: `npm test -- envExampleRoleId user.createSuperAdmin.dast gdpr.exportDecimals.q55 alertRouting.p702
  environmentSchema.p906`: 5 suites, 21 tests passed. `npx eslint` on the three changed test files: clean.
  `npm run typecheck`: 0 errors. `npm run ratchet`: 695 `.js`, at the floor.

## Files

`backend/.env.example`, `backend/src/tests/services/alertRouting.p702.test.js`,
`backend/src/tests/services/gdpr.exportDecimals.q55.test.ts`, `backend/src/tests/config/envExampleRoleId.ci.test.ts`
(new), `docs/BACKEND/11-CONFIGURATION.md` (the `SUPER_ADMIN_ROLE_ID` row). The coordinator's own:
`.github/workflows/ci.yml`, `scripts/ci/e2e-env.sh` (mode).

## Not done / left

- A green run on GitHub is not observed: it needs the push.
- The empty `export-*.zip` files the q55 test leaked into the workstation's `backend/exports` are left in place.
- The suites still read `backend/.env` (jest.config.js), so a workstation `.env` can still hide a dependency on a
  live service. The way to find the next one is this reproduction: a clean Linux clone, `.env.example`, no services.
