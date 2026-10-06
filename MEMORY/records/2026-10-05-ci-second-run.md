# 2026-10-05 — CI's second run on `dded70c`: the audit policy, readable test failures, worker heap

**Run:** GitHub Actions `ci` run 37268522297 on `dded70c` (2026-10-05 05:36–05:53 UTC). 9 of 11 jobs green.
**Author:** CI second-run agent, for the coordinator. No commit or push was made by this agent.
**ADR:** ADR-117.

## What failed

| Job (id) | Step | Public trace |
|---|---|---|
| backend unit + coverage gate (100%) (111630350911) | `npm run test:coverage`, 05:37:11–05:44:00 | one annotation: "Process completed with exit code 1", log line 23,459 |
| npm audit (high and critical fail) (111630351160) | `npm audit --audit-level=high` | 6 high: GHSA-vfj7-8cjw-p6xm (`braces`) and the five packages that depend on it |

The job logs need a token; none is available (no `gh`, no token, and credentials were not extracted from git's store).

## B — `npm audit`: decided, fixed (ADR-117)

**The advisory.** GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 (published 2026-09-18, CVSS 7.5, availability only): `braces` ≤ 3.0.3 overflows the stack on a deeply nested brace pattern. `first_patched_version: null`; 3.0.3 is the latest release.

**Reachability.** `npm ls braces --all`: only `backend > @stoplight/spectral-cli > fast-glob@3.2.12 > micromatch@4.0.8 > braces@3.0.3` and `frontend > eslint-config-next@16.3.6 > @next/eslint-plugin-next > fast-glob@3.3.1 > micromatch` (deduped). `npm ls braces --omit=dev`: **empty**. `npm audit --omit=dev --audit-level=high`: **found 0 vulnerabilities**. Both paths are lint tooling whose only glob inputs are this repository's own patterns.

**Decision.** The job now runs two steps:
1. `npm audit --omit=dev --audit-level=high` — production tree, no exceptions.
2. `node scripts/ci/npm-audit-gate.js` — the whole tree; a high/critical advisory fails unless `scripts/ci/npm-audit-allowlist.json` excuses its GHSA id with an unexpired entry naming its package, and only while the advisory is absent from the production tree. One entry: GHSA-vfj7-8cjw-p6xm, expires **2026-11-05**.

No `overrides`: there is no patched `braces`, and `picomatch` is not a drop-in for `micromatch` under `fast-glob` (ADR-117 § Alternatives). No package file was changed by this agent (U-06's `cls-hooked` removal in `backend/package.json` / `package-lock.json` is untouched; the gate was re-run on the lockfile with that change: still green).

**The gate checked both ways** (saved `npm audit --json` reports of the real tree, `--full/--prod/--today`):

| Case | Result |
|---|---|
| the real tree, live (`node scripts/ci/npm-audit-gate.js`) | `allowed GHSA-vfj7-8cjw-p6xm … (dev only, expires 2026-11-05)`; exit **0** |
| `--today 2026-11-05` | `::error::… allow-list entry expired 2026-11-05: review it`; exit **1** |
| the advisory also in the production report | `::error::… reaches the PRODUCTION tree; an allow-list entry cannot excuse that`; exit **1** |
| the same advisory under an unlisted id | `::error::… not allow-listed` (+ stale-entry warning); exit **1** |
| a clean report | `::warning::… entry … is stale … remove it`; exit 0 |
| `npm audit --omit=dev --audit-level=high` | `found 0 vulnerabilities`, exit **0** |

## A — the coverage job: cause not readable; one probable cause found and removed; failures now annotate themselves

### Making the next failure readable (ADR-117 §5)

- The CI step adds `--reporters=default --reporters=github-actions` (jest 30.5.2 ships the reporter; it is active only when `GITHUB_ACTIONS` is set) and writes `--json --outputFile="$RUNNER_TEMP/jest-results.json"` and a `json-summary` coverage report.
- A new step, `if: failure()`, runs `scripts/ci/jest-annotate.js`: one `::error` per failed suite (≤ 7, with the failing test names and the first lines of the failure or load error), one summary naming every failed suite, and one listing every file below 100% with covered/total per metric. It always exits 0.
- Seen working on Linux in the reproduction below: jest's reporter printed `::error file=…/activityLog.a14.stdout.test.js,line=127,title=…` per failing test; the script printed the suite and summary annotations (11 MB results file). With saved inputs it also annotates a missing results file ("jest wrote no results") and a coverage miss.
- Read them: `curl -s https://api.github.com/repos/zed378/callibrator/actions/runs/<run id>/jobs` → the job id → `curl -s https://api.github.com/repos/zed378/callibrator/check-runs/<job id>/annotations`.

### Reproduction: the GitHub failure does NOT reproduce

| Run | Conditions | Result |
|---|---|---|
| 1 | `node:26.10.0`, `git clone` of a bundle of `main` @ `dded70c`, user `node`, 4 CPUs (`--cpuset-cpus 0-3`), 16 GB, `TZ=UTC`, `npm ci`, `.env.example`, seven random hex-32 secrets, `CI=true GITHUB_ACTIONS=true`, `npm run test:coverage -- --ci --forceExit` | exit **0**: 870 suites passed, 36 skipped; 14,859 tests passed, 233 skipped; **100/100/100/100**; 2,212 s (host shared with three agents) |
| 2 — runner-like | as 1, plus: user `runner` uid 1001, checkout at `/home/runner/work/callibrator/callibrator`, **shallow** (`--depth 1`, branch `main`), `LANG=C.UTF-8`, `HOME`/`RUNNER_TEMP`/`GITHUB_WORKSPACE`, **helm 3.22.0 on PATH** (the runner image has it; it un-skips `schedulerSwitch.w02`'s rendered-chart suite), and the new CI flags | exit **0**: 870 passed; 14,861 passed, 231 skipped (the two helm cases ran); **100/100/100/100**; 2,710 s. Peak container memory **12.27 GiB** |

Ruled out on the way: date (both runs on 2026-10-05, UTC; the date-literal tests inject `now`), timezone, locale (`Intl` identical with and without `LANG`), git identity in `prePushHook.a19` (it sets its own), the helm-gated suite (passes with helm 3.22.0 on Linux and 3.21.2 on Windows), shallow checkout, checkout path, uid.

### What differs and is measured: worker heap

- **Leak, measured** (Windows, Node 26.10.0, 60 route suites in one process, `--expose-gc --logHeapUsage`, no coverage): heap after GC **150 → 1,302 MB**, monotonic, ~20 MB per suite. Unhandling winston's exception/rejection handlers after each file changed nothing (159 → 1,312 MB); the retainer is not identified.
- **With coverage, in band** (Linux, the runner-like container): 2.9 GB of heap after 121 suites, still rising.
- **Node's heap limit** in a 16 GB container: **4,192 MB** (`v8.getHeapStatistics()`). A CI worker runs ~290 files; run 2 held 12.27 GiB across three workers. A worker that reaches the limit dies with its suite, and which files a worker gets depends on the scheduler — a failure that comes and goes by machine.
- The GitHub step log is 23,459 lines; a passing run here is 23,413 lines of jest output. The difference (~46, of which ~20 are the step's header, npm's error tail and the error line) fits **one** failed suite with a short message — e.g. a worker that died — not a coverage miss across files and not many failing tests. This is consistent with the hypothesis; it is not proof.

**Fix:** `workerIdleMemoryLimit: "2GB"` in `backend/jest.config.js` — jest recycles a worker after a file when its heap is above 2 GB; results and coverage of finished files are already reported.

| Run | Conditions | Result |
|---|---|---|
| 3 — runner-like + fix | as 2 + `workerIdleMemoryLimit`, `--logHeapUsage` | 868 passed, **2 failed** (below); **100/100/100/100**; 1,778 s; peak **6.64 GiB** (was 12.27); the largest heap any file reported **1,967 MB** |
| the 2 failed suites, alone, same container | `activityLog.a14.stdout`, `publicAuth.route.p1004` | **2 passed, 22 tests** in 19 s |
| 4 — runner-like + fix, again | as 3 | 869 passed, **1 failed**: `contracts/validation/customDomains.validator.contract` — 10 s test timeout (16,190 ms; every other contract test in the run took ≤ 204 ms); **100/100/100/100**; 1,177 s; largest heap any file reported 1,952 MB |

Run 4's failure is the one the 2026-10-02 closing-gates record already names as load (`customDomains`, `workflow`). Probed: 300 sequential `fetch` + `server.close()` round trips on the harness's pattern, on an idle Windows host and in the container with six CPU burners — the slowest 190 ms and 377 ms, none over 1 s — so it is not a keep-alive wait in `server.close()`. Its cause is not identified. If it ever fails on GitHub, the annotations now say so by name.

The two failures in run 3 were host load, not the change: `activityLog.a14.stdout` spawns a `node --import tsx` child with a 20 s `spawnSync` timeout and got `status: null` (killed at the timeout); `publicAuth.route.p1004` P10-15 took **130 s** for a test that takes 603 ms alone. The workstation was running three other agents' suites and builds at the time.

## Gates

- actionlint 1.7.12 (`rhysd/actionlint:1.7.12`, with shellcheck) on the changed workflow: exit 0, no findings.
- `npm test -- coverageScope.p614 nodeVersion.a257` (the guards that load `jest.config.js`): 18 passed.
- `node --check` on both new scripts; the scripts are outside `backend/` (no backend lint/ratchet scope).
- `npm run ratchet`: **fails on `src/tests/guards/zzW10probe.test.js`**, a new `.js` file that is not this agent's (another lane's probe); nothing in this change adds a backend `.js`.
- `npm run typecheck`: no TypeScript file changed.

## Files

`.github/workflows/ci.yml` (backend-test step flags + annotate step; dependency-audit two steps), `scripts/ci/jest-annotate.js` (new), `scripts/ci/npm-audit-gate.js` (new), `scripts/ci/npm-audit-allowlist.json` (new), `backend/jest.config.js` (`workerIdleMemoryLimit`), `docs/DEVOPS/01-CI-CD.md` (two rows, ADR-117), `MEMORY/DECISIONS.md` (ADR-117), this record, `MEMORY/CHANGELOG.md`, `MEMORY/MEMORY-INDEX.md`.

## Not done / left

- **No full run with the fix was green here**: runs 3 and 4 each failed on timing tests (3 suites in all) that pass alone, on a workstation shared with three other agents; coverage was 100% in both. Runs 1 and 2 (without the fix) were green.
- **A green coverage job on GitHub is not observed**, and the GitHub failure's cause is not proven. The next push either goes green or names its failing suite in annotations.
- The leak's retainer is unknown (heap snapshots across files are the next step).
- The allow-list entry expires 2026-11-05: renew only after a review (ADR-117 §4).
- Docker: containers `ci2-ci-second-run`, `ci2-gh-like`, `ci2-actionlint` (the last ran `--rm`) — removed by name; image `node:26.10.0` and `rhysd/actionlint:1.7.12` left pulled.
