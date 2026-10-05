# Closing deploy of Phases 9–10 to the reference VM

**Date:** 2026-10-02 (checks repeated 2026-10-05) · **Commit deployed:** `1100658` · **Tasks:** P10-16 / U-08 (live steps 1–4), ADR-041 status, P10-05 configuration
**Target:** VM `10.1.200.13`, `/home/infra/callibrator`, public at https://kalibrasi.zedth.my.id (Cloudflare Tunnel → `:19080`)

## What was done

1. **Configuration checked before the wipe**, by variable name only and no value printed. The new boot-time schema (P9-06, ADR-087 Am. 30) requires `ACCESS_REQUEST_IP_PEPPER` in production (P10-05), and the VM's `.env` did not have it. Without it the backend refuses to start. `.env` was backed up (`.env.bak-20261002-*`), then a random 32-byte hex value was generated **on the VM** with `openssl rand` and appended. The value was never displayed.
2. **Wipe, as the owner directs.** For project `callibrator` only: `docker compose -p callibrator -f docker-compose.yml -f docker-compose.vm.yml down -v --remove-orphans`, then `deploy/compose/volumes/*` emptied through an `alpine:3` container.
3. **First attempt failed.** `git reset --hard origin/main` could not overwrite about 280 files in the checkout, because they were owned by a uid other than `infra` (1000). These were left by an earlier upload, under `backend/src/{tests,models,constants,utils,types}`, `frontend/src/{app,components,lib,api}` and others. The checkout was left half-updated. `build:dist` then failed inside the backend image (`Dockerfile:107`), and **the script went on to `up -d` with the old images**. The old backend briefly ran against the just-wiped, empty database. No data was at risk, but the script was wrong to continue.
4. **Second attempt:**
   - wipe again;
   - give ownership back to uid 1000 with `alpine:3` (`find /r -path /r/deploy/compose/volumes -prune -o ! -user 1000 -exec chown 1000:1000 {} +`; 0 files left with another owner);
   - `git reset --hard origin/main`, then `git clean -fd` with `.env`, its backups and `volumes` excluded (0 dirty files);
   - build, **stopping without starting anything if the build fails**;
   - `up -d`.

   Both images built from `1100658`. All seven containers are healthy (backend, frontend, nginx, postgres, redis, rabbitmq, clamav).
5. **PostgreSQL is 18.6** (`pgvector/pgvector:pg18`). `select version()` gave `PostgreSQL 18.6 (Debian 18.6-1.pgdg12+2)`. The wipe made the 17→18 move without a dump and restore, as the owner decided. ADR-041's status, the runbook, PROGRESS, `docs/README.md` and CLAUDE.md are updated.
6. **Seeding the super admin.**
   - Back up `.env`, set `ALLOW_SEEDING=true`, recreate the backend, then `GET /api/v1/migration/seeding`. The answer: `usersCreated: 1`, `bootstrapPasswordFile: "/app/.bootstrap/superadmin-password"`, and no password in the response.
   - Then `ALLOW_SEEDING=false` again and recreate the backend.
   - Afterwards the endpoint answers **401** and `.env` has `ALLOW_SEEDING=false` and `SEED_DEMO=false`.
7. **Finding: the documented procedure loses the password.** Changing `.env` means *recreating* the container, and `/app/.bootstrap` is deliberately not a volume (ADR-099). So the recreate after turning seeding off **discarded the file the seed had written**: `ls -A /app/.bootstrap` came back empty.
   - The password was then issued with the recovery CLI: `./backend rotate-bootstrap-password --user sys@mail.com --requested-by "coordinating-session (closing deploy 2026-10-02)" --ticket U-08-closing-deploy`, exit 0, "every session revoked".
   - `deploy/README.md` § Closing deploy, step 3, now says this: after the seeding toggle, always issue the password with the CLI.

## U-08 live results (steps 1–4 of `deploy/README.md` § Closing deploy)

| Step | Check | Result |
|---|---|---|
| 1a | `/app/.bootstrap` mode and owner | `700 app:app` ✅ |
| 1b | anything mounted on it | 0 ✅ |
| 2 | `./backend rotate-bootstrap-password` with no arguments | exit 1, "Rotation refused: --user, --requested-by and --ticket are all required" ✅ |
| 3 | rotation with all three arguments | exit 0; the pointer line names the file and the container's host ✅ |
| 4a | the pointer line in `docker logs` | the documented grep for `sys@mail.com` counts **0**, because the logs mask the address as `s***@mail.com` and the CLI's own output names the file. The README grep is corrected |
| 4b | the file's mode | `600 app` ✅ |
| 4c–e | the value in `docker logs`, `env`, `deploy/compose/volumes` | **0, 0, 0** ✅. The value was read into a shell variable on the VM, its length checked (24) and the variable unset. It was never printed |

**Steps 5–6** (signing in with the password in a browser, then an admin reset) were **deliberately not run**. Signing in uses the password up, and the owner wants to read it inside the container and do the first sign-in themselves (`docker exec callibrator-backend-1 cat /app/.bootstrap/superadmin-password`). They stay owed to the owner's first sign-in.

## Public smoke (https://kalibrasi.zedth.my.id)

- `/`, `/login`, `/request-access` and `/verify` answer **200**. The landing `<title>` is "Device Calibrator — Kalibrasi alat kesehatan, tercatat dan terdokumentasi".
- `/api/v1/migration/seeding` answers **401**.
- `POST /api/v1/auth/login` with the retired `123123` answers **401**.

## Other projects on the host

Before the deploy, the VM ran 39 containers: 7 for callibrator and 32 for other projects. Afterwards, the other 32 were **identical** (`diff` of the sorted names). No prune was run, and only resources named for this project were touched.

## Still open

- **U-08 steps 5–6:** the owner's first sign-in.
- **`PRIVACY_NOTICE_URL`** is unset on purpose, so request access stays closed (ADR-113) until the owner publishes the notice.
- **Lighthouse AC-5/6** against the VM.
