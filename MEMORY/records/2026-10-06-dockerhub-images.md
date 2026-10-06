# P7-09: the images are on Docker Hub; compose, the VM and Helm pull them

**Date:** 2026-10-06 · **Task:** P7-09 (new card, owner request) · **Decision:** [ADR-123](../DECISIONS.md) · **Base commit:** `3e91413` (the working tree, not committed)

## The request

The owner pushed three public images to Docker Hub on 2026-10-06, built at the repository root from `3e91413`, and asked that "after this push, it will simplify docker compose and deployment":

| Image | Tags | Digest |
|---|---|---|
| `zed378/calibration-be` | `latest`, `3e91413` | `sha256:4f82017aa0570d2c4a2737c20c9dd4e619dbeae405b9cafd9f7cee379214f046` |
| `zed378/calibration-fe` | `latest`, `3e91413` | `sha256:fafbd089e7b59746cf5c674529fd81066991770f52b38c4bdc7bd75ee1c7adf7` |
| `zed378/calibration-backup` | `latest`, `3e91413` | `sha256:e420bc6baa1f42b95465834fe45b6b157efefabd3c99283605ea226a3b429412` |

The frontend was built with `NEXT_PUBLIC_API_BASE_URL` = `NEXT_PUBLIC_SITE_URL` = `https://kalibrasi.zedth.my.id`, API `v1`, no tenant id and empty contact channels, so it serves the reference deployment only. Nothing was pushed in this change, and the VM was not touched.

## What changed

**Compose (`deploy/compose/`)**

- `docker-compose.yml` declares `image:` only, defaulting to `zed378/calibration-{be,fe,backup}:${IMAGE_TAG:-latest}`, with an optional per-image `${BACKEND_DIGEST:+@…}` (and `FRONTEND_`, `BACKUP_`). Its three `build:` sections moved out.
- **New `docker-compose.build.yml`** is the only file that builds. It declares the three builds, the frontend's `NEXT_PUBLIC_*` args from the environment, and `additional_contexts: backend-image: service:backend` for the backup verifier. It tags local builds `callibrator/<name>:${BUILD_TAG:-local}` with `pull_policy: build`.
- `docker-compose.vm.yml` has no build. Its frontend `build.args` block was removed, and its header gives the pull-based procedure and the frontend's one-URL limit.
- `docker-compose.prod.yml` and `docker-compose.staging.yml`: Docker Hub defaults and the digest suffix. Prod keeps `build: !reset null`.
- `docker-compose.dev.yml` and `docker-compose.e2e.yml`: the headers say to stack the build overlay beneath them.
- `.env.example`: Docker Hub names, `BACKUP_IMAGE`, the three `*_DIGEST`, the pinning recommendation, and a warning that an older `.env` names repositories that do not exist.

**Helm (`deploy/helm/callibrator/`)**

- Repositories default to the Docker Hub names, in the umbrella and in both subcharts.
- New optional `image.digest` for the backend, the frontend and `backupVerify`, rendered as `repository:tag@digest`. A guard in `guards.tpl` refuses any digest that is not `sha256:<64 hex>`.
- `NOTES.txt` shows the digest. The tag stays required.

**Release script (`scripts/release/push-images.ps1`, new)**

- PowerShell 5.1 and 7.
- Refuses a dirty tree: a tracked change anywhere, or an untracked file in the image inputs.
- Builds be → fe → backup, with OCI labels.
- Scans each image before anything is pushed:
  - the filesystem, as root, with no network: sensitive file names outside a base-image allow-list, and any `.npmrc` that carries auth;
  - secret-named environment variables that have a value;
  - `docker history` patterns;
  - the frontend must carry its API URL.
- Pushes `<sha>` then `latest`, and prints the digests in compose and Helm form.
- `-DryRun` / `-NoPush`: build and scan only. A dirty tree is then tagged `<sha>-dirty` and never `latest`.
- `-ScanTag <tag>` scans only.
- Refuses to push a non-reference URL into `zed378/calibration-fe`.

**Other files**

- `deploy/backup/Dockerfile.dockerignore` (new) is an allow-list of the one file the Dockerfile copies. Before it, the whole repository root went to the daemon on every backup build.
- **CI (`.github/workflows/ci.yml`)**:
  - `deploy-config` validates the base file alone, the build overlay, and build + dev. It asserts that staging, prod and vm contain no service that would build, and adds two digest refusals to the Helm guard checks.
  - `browser-a11y` stacks the build overlay in all six compose invocations, builds the backup verifier from the backend it just built (no push), and removes it on teardown. It also runs for PRs that touch `deploy/backup/`.
- **Makefile**:
  - Docker Hub names, plus `BACKUP_IMAGE`.
  - `ENV=dev` stacks the build overlay.
  - `images` builds all three; `push` pushes all three.
  - **New `make deploy-vm`**: `pull`, then `up -d`, then wait for healthy. Without `TAG=` it uses `.env`'s last `IMAGE_TAG` line, not a silent `latest`.
- **Guard**: `composeBuildContext.a332.guard.test.ts` was rewritten. There are six cases:
  - only the build overlay declares a context or a Dockerfile, and all three go through `BUILD_CONTEXT`;
  - base, vm, staging and prod declare no build;
  - base defaults to the Docker Hub names;
  - the build overlay tags `callibrator/*` with `pull_policy: build`.
- **Documents**: ADR-123; `deploy/README.md` (the tree, Pull or build, the VM deploy step by step, the wipe rule and the seed → CLI password rule kept, the per-environment frontend, the backup image, the `DC` invocation corrected); `README.md` (Deploying: images are pulled, not built; Commands); `docs/DEVOPS/00`, `01` (Images, the CI table, the build stage), `02` (A-332 section), `08` (rollback by tag), `11` (images, push, deploy-vm); `docs/ARCHITECTURE/08` (the compose file table); `TASKS/RUNBOOK-POSTGRES-18-UPGRADE.md` step 4 (pull instead of `--build`).

## How the VM deploy works now

1. **Release**, on a workstation (PowerShell or cmd, after `docker login`): `pwsh -File scripts/release/push-images.ps1`.
2. **On the VM**: `git fetch && git reset --hard origin/main`. The checkout supplies only the compose files and the nginx config.
3. **Check `.env`**, by variable name only:
   - Change `BACKEND_IMAGE` and `FRONTEND_IMAGE` from `callibrator/*` to the `zed378/*` names, or delete the lines. The VM's `.env` predates this change, and `pull` fails on the old names.
   - Pin `IMAGE_TAG=<short commit>` (recommended) and, optionally, the three `*_DIGEST`.
4. **Pull and start**, from `deploy/compose`, or with `make deploy-vm`:
   - `docker compose -p callibrator -f docker-compose.yml -f docker-compose.vm.yml pull`
   - `docker compose -p callibrator -f docker-compose.yml -f docker-compose.vm.yml up -d`

   Nothing is built, and a failed pull changes nothing that is running.
5. **Verify**: `ps` shows everything healthy, the site answers, `/api/v1/migration/seeding` answers 401, and `docker inspect` names the intended tag and digest.
6. **Roll back**: set the previous `IMAGE_TAG` and digests, then pull and `up -d` again.

Wiping stays the owner's decision (project `callibrator` only, `down -v --remove-orphans`, volumes emptied through `alpine`). After a wipe, the one-time password is issued with the rotation CLI after the seeding toggle.

## Evidence

| Gate | Command | Result |
|---|---|---|
| Guard | `npm test -- src/tests/guards/composeBuildContext.a332.guard.test.ts` (Node 26.10.0) | **6/6 passed** (the npm exit is 1 only because of the per-directory coverage thresholds on a one-file run) |
| Lint | `npx eslint` on the guard; `node scripts/ci/eslint-ratchet.js` | clean; "0 error(s), 0 warning(s); baseline 0" |
| Typecheck, ratchet | `npm run typecheck`; `npm run ratchet` | exit 0; "695 .js file(s), at the floor" |
| Compose | `docker compose config -q` (Compose v5.3.1) with the CI `.env` | base, build, build+dev, staging, prod, vm, build+vm: **all OK** |
| CI compose step | the `deploy-config` step's script, extracted from the workflow and run locally with `RUNNER_TEMP` set | exit 0: base/build/build+dev ok; staging, prod, vm "services that would build: none"; dev ports none on 0.0.0.0; e2e (build + e2e) services `backend frontend mailpit postgres rabbitmq redis volume-init` |
| Pull-only check, failing direction | the same Python check on base + build + vm | exit 1, `['backend', 'db-backup', 'frontend']` |
| Helm | helm v3.21.2 (CI pins 3.19.0); kubeconform v0.7.0 (`ghcr.io/yannh/kubeconform:v0.7.0`), `-strict`, Kubernetes 1.33.0 | lint 0 failed for dev ×2, staging, prod and dev with `backupVerify` on. kubeconform valid: dev **14/14** (two release names), staging **11/11**, prod **12/12**, dev + `backupVerify` **17/17**, prod + `backupVerify` + all three digests pinned **15/15** |
| Helm refusals | the CI `refuse` loop plus three new digest cases | all 10 refused as required; a pinned render gives `zed378/calibration-be:3e91413@sha256:4f82…f046` (fe, backup likewise) |
| actionlint | `rhysd/actionlint:1.7.12` (with shellcheck) on `ci.yml` | exit 0, no findings |
| PSScriptAnalyzer | 1.25.0 (saved to the scratchpad, not installed), all severities | **0 findings** (Write-Host suppressed with a stated justification) |
| Release script, build | `pwsh -File scripts/release/push-images.ps1 -DryRun` with `adr123-dryrun/*` repositories (dirty tree) | all three built in order, tag `3e91413-dirty`, no `latest`; untracked input `deploy/backup/Dockerfile.dockerignore` reported; scan passed (be 151 names, all CA store; fe 3; backup 4); fe "inlined API URL: present"; exit 0 |
| Release script, failing direction | a deliberately bad image (`.env`, `.key`, `.git`, `.npmrc` with `_authToken`, `ENV DB_PASSWORD=…`, a `RUN` with `API_TOKEN=…`) scanned with `-ScanTag bad`, under pwsh 7.6.6 **and** Windows PowerShell 5.1 | exit 1 under both: 4 file names, the `.npmrc` auth, the env variable, 2 history patterns and the missing URL were all reported, and "nothing was pushed" |
| Release script, published images | `powershell.exe -File … -ScanTag 3e91413` (5.1) | passed; registry digests printed **equal the owner's three digests** |
| Release script, URL refusal | a clean temporary worktree at `HEAD`, `-PublicUrl https://cal.example.org` with the default frontend repository | "REFUSED: zed378/calibration-fe serves https://kalibrasi.zedth.my.id …", exit 1, before any build |
| Makefile | GNU make in `alpine:3.20` with a stub `docker` | `make -n images push TAG=abc1234` gives the three builds (backup with `--build-context backend-image=docker-image://zed378/calibration-be:abc1234`) and three pushes; `deploy-vm` uses `.env`'s last `IMAGE_TAG`, `TAG=abc1234` overrides it, and it runs `pull` then `up -d` on base + vm only |
| **VM overlay pulls and starts, no build** | scratch copy of `deploy/compose`, `-p adr123-vmpull`, env from `scripts/ci/e2e-env.sh` + `IMAGE_TAG=3e91413` + 29xxx ports; `pull`, then `up -d --no-build` | pull exit 0; up exit 0. backend, frontend, postgres, redis, rabbitmq and clamav healthy; nginx and db-backup running ("next run at 02:30"). `/health` 200, nginx `/` 200, `/api/v1/migration/seeding` **401**. The containers run `zed378/calibration-{be,fe,backup}:3e91413` at exactly the owner's digests |
| Digest pins | the same stack with `BACKEND_DIGEST`, `FRONTEND_DIGEST`, `BACKUP_DIGEST` | `config --images` shows `…:3e91413@sha256:…` for all three; `pull` of the three says "Pulled" |
| CI's new backup build step | `docker compose -p adr123-e2ebuild … -f docker-compose.build.yml -f docker-compose.e2e.yml build db-backup` | exit 0; `callibrator/backend:local` and `callibrator/backup-verify:local` built |

**Not run**: the full backend suite and coverage (one guard test changed), `make verify`, the live E2E, and the CI workflow on GitHub (nothing is pushed). The new `browser-a11y` step runs for the first time on the next push to `main`. `shellcheck` is not installed locally; actionlint ran it on the workflow's scripts.

## Cleanup (by name)

- Removed: the `adr123-vmpull` stack (`down -v --remove-orphans`, its network, and the scratch bind volumes through `alpine`).
- Removed images: `adr123-dryrun/calibration-{be,fe,backup}:3e91413-dirty`, `adr123-neg/{be,fe,backup}:bad`, `callibrator/backend:local`, `callibrator/backup-verify:local`, and `ghcr.io/yannh/kubeconform:v0.7.0`. Also `clamav/clamav:1.4@sha256:a5f0…` (pulled for the test; the VM pulls its own).
- Removed: the temporary worktree, and the `deploy/compose/.env` made for `config`.
- Kept: the owner's `zed378/*` images, `callibrator/{backend,frontend}:latest`, and `rhysd/actionlint:1.7.12`, which were present before. No prune was run.

## Follow-ups

- **A runtime-configured frontend** would let one image serve every URL (ADR-123, alternatives). Until then the published frontend serves the reference deployment only.
- **Publishing from CI**, after a green run, with provenance (cosign or SBOM). This is P7-01's remainder. The release is a person at a workstation today.
- **The VM's `.env`** still names `callibrator/*` until the next deploy follows step 3. The owner's next deploy is the first pull-based one.
