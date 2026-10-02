# 2026-10-02 — Closing verification for Phases 9–10: every gate on the quiet tree, and the live pair Q/R green

**Cards:** P10-13 (live acceptance evidence), Phase 9 close-out gates. **Asked by:** the coordinator, as the last check before the Phase 9–10 commit. **Standard:** ADR-077 (named runs; one uninterrupted run, twice). **Tree:** the working tree on `fb55605` (HEAD = `origin/main`), **quiet** (no other agent editing) from 06:45 to 09:05 +07:00.

**Result:**
- Every gate `make verify` runs is green, run command by command (no `make` here): 0 errors.
- **One check fails: `openapi:breaking` against `origin/main` reports 857 breaking changes.** This is the contract change of Phase 9, not a defect in this tree. It needs a recorded decision before it reaches a pull request; see § 2.
- **Live pair Q and R green**, back to back on one fresh production-mode stack built from the final tree. Both runs: E2E 433 passed, 0 failed; smoke 7/7; a11y 80/80; responsive 45/45; P10 12/12. 0 × 5xx; six 429s, all asserted by the specs.
- Migration **0108 applied on boot** (fresh database: 80 migrations applied, then the schema check reported OK). It was then also proved on the **upgrade path**, live (§ 3.3).
- **No source was changed.** No gate needed a fix.

## 1. Gates (2026-10-02, quiet tree, Node 26.10.0)

| Gate | Command | Result |
|---|---|---|
| Backend typecheck | `cd backend && npm run typecheck` | exit 0, 0 errors |
| TS ratchet | `npm run ratchet` | "695 .js file(s), at the floor" |
| Backend lint gate | `node scripts/ci/eslint-ratchet.js` (repo root) | "0 error(s), 0 warning(s); baseline 0" |
| Backend lint (turbo's script) | `cd backend && npm run lint` | exit 0 |
| `build:dist` | `npm run build:dist` | 604 TypeScript files compiled, 7 JavaScript files copied; contracts 52 compiled |
| Backend build (as `make build`) | `npm run build` (`openapi:check` + `build:dist` + `pkg`) | exit 0; `dist/backend-linux`, `dist/backend-win.exe` |
| Load check, dist | `TSX_DISABLE_CACHE=1 npm run load:check` | OK: 595 modules; boot order 105 |
| Load check, src | `TSX_DISABLE_CACHE=1 npm run load:check -- --src` | OK: 595 modules; boot order 105 |
| OpenAPI current | `npm run openapi:check` | "backend/openapi.json is current" |
| Spectral | `npm run openapi:lint` | no new error; 0 baselined; 15 warnings |
| **oasdiff** | `npm run openapi:breaking`, oasdiff 1.32.1 (Windows binary in the scratchpad, not installed) | **exit 1: 857 errors, 34 warnings against `origin/main`** (§ 2) |
| **Backend coverage** | `npm run test:coverage -- --ci` (06:51:46–06:57:17) | **100 / 100 / 100 / 100**; **869 suites passed, 36 skipped, 0 failed**; 14,859 tests passed, 231 skipped; 329 s |
| `packages/contracts` | `npm run lint`, `npm run typecheck`, `npm test` | lint 0, typecheck 0; **47 suites, 1,084 tests, 100 %** on all four measures |
| Browser specs (TypeScript) | `node node_modules/@typescript/native/bin/tsc -p automate/tsconfig.json` | exit 0 |
| Frontend typecheck | `cd frontend && npm run typecheck` | exit 0 |
| Frontend lint | `npm run lint` | **0 errors**, 55 warnings |
| Frontend types from the contract | `npm run api:types:check` | exit 0 |
| **Frontend coverage** | `npx jest --coverage --ci` | **292/292 suites, 3,063 tests**; 93.84 / 84.58 / 89.65 / 94.52 (gate 90 / 81 / 86 / 91) |
| `next build` | `npx next build` | exit 0; 84 static pages |
| Bundle budget | `node scripts/bundle-budget.mjs` | all 10 public routes within (e.g. `/` brotli 123.4 / 180 KB, `/verify/[n]` 117.9 / 120 KB, `/login` 152.6 / 155 KB) |
| gitleaks 8.30.1 (`.tools/bin`) | `gitleaks git --config .gitleaks.toml --redact .` | 52 commits, **no leaks** |
| | `gitleaks dir` on the **954 modified and untracked files**, copied as-is into a scratch directory, with the repository's config and `.gitleaksignore` | **no leaks** |
| | `gitleaks dir .` on the whole checkout | 645 findings; I treated them as all in ignored build and dependency trees (`node_modules`, `dist`, `.next`). The two scans above cover every file a commit would carry. |

Coverage note: the two validator contract tests that timed out under load in the previous run (`customDomains`, `workflow`) passed in this run. The previous failures were load, not a defect.

## 2. oasdiff: 857 breaking changes against `main`

- **What it compares:** `origin/main` is `fb55605`, the same commit as HEAD. Its `openapi.json` was mostly built from JSDoc: 415 operations, of which 44 carry `x-permission`.
- **The working tree's contract** is code-first from the Zod schemas: 479 operations, of which 427 carry `x-permission` (P9-25, ADR-103).
- **What the 857 errors are:** almost all are the contract describing what `validate()` already enforces. The largest groups:

| Group | Errors | Examples |
|---|---|---|
| Path patterns added | 148 | `request-parameter-pattern-added` |
| New request constraints | 336 | patterns 57, min-length 73, max-length 61, min 16 + 37, max 21 + 37, became-enum 13, enum values removed 44 |
| Required where it was optional | 80 | `request-property-became-required` 28, `request-body-became-required` 16, `request-body-added-required` 19, `new-required-request-property` 17 |
| Response descriptions corrected | 206 | `response-property-became-nullable` 80, `response-property-list-of-types-widened` 64, `response-property-type-changed` 32 |
| Paths removed without deprecation | 11 | |
| Success statuses removed | 5 | |

- **Earlier records predicted this.** It was flagged by the stage-C services record ("a hit there is the contract catching up") and by A-346, both written without `oasdiff` available. This run is the first time the check has actually been run against `main`.
- **What CI will do:**
  - On a **pull request**, the `api-contract` job will fail.
  - On a **direct push to `main`**, it compares the pushed commit with itself (`OPENAPI_BASE_REF=origin/main` is the pushed commit), and passes.
- **What is needed:** the script's own instruction, "record the break (ADR + deprecation note) before merging". That is a decision about how a published contract changes, so I **did not write the ADR**. **Open for the coordinator.**
- Not checked one by one: the 11 removed paths and 5 removed success statuses are listed in `qr/oasdiff.txt` in the scratchpad.

## 3. The live pair

### 3.1 Stack and procedure

- **Procedure:** as the K/L record ([record](./2026-10-02-a346-a348-live-pair-kl.md) § 4); its scripts were copied from the scratchpad `pairkl/` to `pairqr/`, with only the project name and ports changed.
- **Snapshot:** a robocopy snapshot of the final tree at **07:13:55 +07:00**.
  - Copied: `backend`, `frontend`, `packages/contracts`, `automate`, `deploy`, and the root manifests.
  - Checked: the file counts of `backend/src`, `frontend/src`, `automate`, `deploy` and `packages/contracts/src` match, and `diff -rq` on both `src` trees is empty. **No snapshot-only patch.**
  - The repository has no root `shared/` directory, so robocopy's exit 16 was for that path only.
- **Stack:**
  - project **`p1013qr`**, production mode, ports 27160–27162;
  - env from `scripts/ci/e2e-env.sh` with `PRIVACY_NOTICE_URL=https://example.com/privacy-notice`;
  - images built 07:15–07:25;
  - fresh named volumes, then `up --wait`, then `GET /api/v1/migration/seeding` (200);
  - the bootstrap password read with `docker exec … cat /app/.bootstrap/superadmin-password`. It is 24 characters, and occurs **0 times** in `docker logs`.
- **Each run:** `npm run test:e2e`, then `automate/smoke.browser.js`, `a11y.browser.js`, `responsive.browser.js` and `p10.browser.mts`.
- **Between Q and R:** the script waited for the P10 per-address budget keys to expire, without flushing Redis: 07:43–08:43.

**Monitors, the whole time (07:26–09:01):**
- host probe (backend `/live`, Mailpit `/livez`, frontend `/login`, every second);
- in-network curl probe on `p1013qr_default`;
- `docker stats`;
- VM sampler (`/proc/stat` incl. steal, PSI);
- **cgroup sampler** (`cpu.stat` and pressure per container);
- Windows `typeperf`, and the top host processes every 10 s.

### 3.2 Results

| Run | Window (+07:00) | E2E (57 files) | smoke | a11y | responsive | P10 browser |
|---|---|---|---|---|---|---|
| **Q** | 07:26:51–07:43:21 | 56 passed, 1 skipped; **433 passed**, 5 skipped, **0 failed** (32.5 s) | **7/7** | **80/80** (773 s) | **45/45** | **12/12** |
| **R** | 08:43:30–09:00:06 | 56 passed, 1 skipped; **433 passed**, 5 skipped, **0 failed** (28.3 s) | **7/7** | **80/80** (771 s) | **45/45** | **12/12** |

- 433 is the same count as O/P: no spec was added or removed since that pair.
- P10's `sso` check is skipped by name, as in every earlier run; it needs a non-production backend. It is counted in the 12.

**Access log** (`/app/log/access/access.log`, the whole stack life):

| | Lines | 5xx | 429 |
|---|---|---|---|
| after Q | 1,532 | **0** | 3 |
| after R | 3,054 | **0** | **6**: 2 × `POST /access-requests`, 4 × `GET /certificates/verify/…` |

- Every 429 is one the P10 specs assert: the intake budget and the minimal verification verdict.
- 81 lines with status `-` are browser requests aborted by navigation (K+L had 82).
- node-cron "missed execution": **0**.

**Stall watch, ~95 min fully instrumented (none):**
- **In-network** maxima: backend 0.29 s, Mailpit 0.01 s, frontend 0.34 s, with 0 probes over 1 s (about 5,600 each).
- **Host-side:** one blip at 08:41:21, during the idle wait. All three targets were slow together (backend 1.97 s, Mailpit 1.85 s, frontend 1.97 s), while in-network stayed fast. That is Docker Desktop port forwarding, the same signature as the K blip.
- Host timer drift: 0.
- VM steal: 0 throughout (`/proc/stat` steal column 0 at both ends).

The host/VM stall seen once in M did not recur. It stays as recorded there: open, attributed to the host.

### 3.3 Migration 0108

**Fresh boot:**
- The log shows `[migrate] migrated 0108-tenant-backup-name-description.js`, then "Applied 80 migration(s)", then `[schema-verify] OK: 74 tables, 927 columns and 13 control objects match the models`.
- `make migrate-verify` reads the last of these lines, so its verdict is OK.
- `schema_migrations` holds the 0108 row, and `\d tenant_backups` shows `name varchar(100)` and `description varchar(500)`, both nullable.

**Upgrade path** (after the pair, on the same database with 2 backups):
- In one transaction: dropped both columns and deleted the 0108 row, as on a database written before 0108.
- Restarted the backend. Result:
  - "Applied 1 migration(s): 0108-tenant-backup-name-description.js" (0.06 s);
  - `[schema-verify] OK: 74 tables, 927 columns …`;
  - both columns back as `character varying(100)` and `character varying(500)`, nullable;
  - the row recorded.
- **Not run:** `npm run migrate:verify` itself. That is a host command against `backend/.env`; the release binary has no verify subcommand. The boot's `[schema-verify]` verdict is what `make migrate-verify` checks.

## 4. Docker

- **Removed:** project `p1013qr` with `down -v --remove-orphans`, then images `p1013qr/backend:e2e` and `p1013qr/frontend:e2e` by name.
- **Monitor containers** (`p1013qr-netprobe`, `-vmstat`, `-cgstat`, all `--rm`) were stopped by name. They ran on the pre-existing `alpine:3` and `curlimages/curl:latest` images; nothing was pulled.
- **Afterwards:** 0 containers, volumes, networks or images match `p1013qr`. Nothing was pruned, and no other project was touched.
- **Evidence** (access log, backend logs before and after the 0108 check, every monitor log, run logs) is in the session scratchpad: `pairqr/` (`runs/Q`, `runs/R`, `mon/`, `qr-evidence/`) and `qr/` (gate logs, `oasdiff.txt`).

## 5. The working tree, checked for accidents

There are 1,124 changed paths: 550 modified, 171 deleted, 403 untracked.

| Check | Result |
|---|---|
| A `.js` beside a `.ts` of the same name, on disk | **none** |
| Every deleted `.js` has its `.ts` or a recorded deletion | yes. The deletions without a twin are `scripts/rotate-default-credentials.js` (A-344), `middlewares/auditLog.middleware.js` and its 2 tests (P9-19 round 3), and 13 `.d.ts` shims of modules that are now `.ts` |
| Modified files whose diff is only whitespace or CRLF | **none** |
| Secrets | gitleaks: none (§ 1) |
| Gate runs left files behind | none: `git status` was identical before and after the gates (build output is ignored) |
| Untracked names that look like scratch (`.bak`, `.orig`, `.log`, `.env`, keys) | none. The only name matches are the A-363 backup feature's files |
| Untracked files CI depends on | `deploy/compose/docker-compose.e2e.yml` and `scripts/ci/e2e-env.sh`. **They must be in the commit.** |

## 6. Files changed by this verification

- `MEMORY/records/2026-10-02-closing-gates-qr.md` (this record)
- `MEMORY/CHANGELOG.md`, `MEMORY/MEMORY-INDEX.md`
- `TASKS/PROGRESS.md`, `TASKS/PHASE-10-LANDING-AUTH-REVAMP.md` (P10-13 evidence)
- `CLAUDE.md` § What Is Currently Failing (coverage, lint, typecheck/build/load, live E2E rows); `README.md` § Current State (the same three rows)

## Open

1. **The oasdiff break against `main`** (§ 2): it needs an ADR and deprecation note, or a decision to land on `main` directly, before a PR. Coordinator or owner.
2. **P10-13's human items stay open:** the keyboard and NVDA walks, Lighthouse AC-5/6 on a quiet machine, and the owner's § 14 items.
3. **`CLAUDE.md` names a root-level `shared/` area that does not exist** in this checkout. Not changed here (outside the rows I was asked to update).
4. **README § Scale** says 478 API operations; the generated `openapi.json` has 479 operations under `paths`. Not changed here.
