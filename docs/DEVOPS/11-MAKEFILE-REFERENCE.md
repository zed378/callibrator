# 11 — Makefile Reference

`make help` lists everything. This document explains the targets that do more than they look like.

Two variables govern almost every target:

```
ENV=dev|staging|prod|vm   selects the compose overlay
TAG=<image tag>           the image to run
```

---

## Setup

| Target | Does |
|---|---|
| `make env` | copies `deploy/compose/.env.example` to `.env`, refusing to overwrite an existing one |
| `make secrets` | generates the **four** required secrets plus the JWT pair |
| `make install` | `pnpm install` |

`make secrets` prints values and a warning, because the warning matters more than the values:

**`CERT_SIGNING_SECRET`, `ENCRYPT_KEY` and `KMS_MASTER_KEY` must be backed up separately from the database.** Losing them produces a system that starts cleanly and is permanently broken — every issued certificate fails public verification, every wrapped credential is undecryptable. Neither is practically rotatable.

`KMS_MASTER_KEY` is the fourth. It was **missing from this target until a deployment found it**, and the way it fails is the argument for checking it here: the container crash-loops with **nothing in `docker logs`**, because the throw happens after winston is configured and the message lands only in `log/activity/exception/<date>.log`. `make check-env` now refuses on it like the other three.

## Development

| Target | Does |
|---|---|
| `make dev` | `up ENV=dev` then follows logs |
| `make up` | starts the stack, then **blocks until the backend is healthy** |
| `make down` | stops; volumes preserved |
| `make destroy` | stops **and deletes all data** — requires typing the environment name |
| `make restart` | restarts only backend and frontend |
| `make logs [SERVICE=backend]` | follows logs |
| `make ps` | container status |
| `make shell [SERVICE=backend]` | shell into a container |
| `make psql` | psql against the running database |

### `make up` waits for healthy, not started

The health check is `/health`, which calls `db.authenticate()` and returns **503** when the database is unreachable. A container that is "started" is not a container that is serving.

On failure it prints the last 50 backend log lines and a reminder that a 503 from `/health` points at the **database**, not the application.

### `make destroy` asks for the environment name

Not "are you sure". Typing `prod` to destroy production is a different act from pressing `y`.

It deletes `deploy/compose/volumes` — the database, uploads, backups, and Redis **including in-flight worker idempotency claims**.

## Database

| Target | Does |
|---|---|
| `make migrate` | runs pending migrations, then tells you to verify |
| `make migrate-status` | pending list |
| `make migrate-undo` | rolls back the last |
| **`make migrate-verify`** | **queries `information_schema` for the real column counts** |
| `make seed-demo` | demo data — **refuses outside `ENV=dev`** |
| `make backup` | `pg_dump` into `./backups`, then tells you what a dump is not |

### Why `migrate-verify` exists

**A migration wrapped in a blanket `try/catch` around `describeTable` is recorded as applied while doing nothing.** Umzug reports success, the column never appears, and the failure surfaces weeks later as a missing-column runtime error.

`make migrate` prints this immediately after running, because the migration log is not evidence:

> Now VERIFY THE COLUMNS. A migration wrapped in a blanket try/catch is recorded as applied while doing nothing.

### Why `make backup` argues with itself

It produces a database dump and then says a dump is not a backup: without the object store and **without `CERT_SIGNING_SECRET` and `ENCRYPT_KEY`**, restoring it produces a system that starts and cannot verify a single certificate.

### Why `make seed-demo` refuses outside dev

A demo seeder running against real data is a data-integrity incident. The guard is `ENV != dev` → exit.

## Quality Gates

| Target | Does |
|---|---|
| `make lint` | both workspaces |
| `make typecheck` | **frontend only** — the backend is JavaScript (ADR-030) |
| `make test` | unit and integration |
| `make test-e2e` | 51 live specs against a **running** server |
| `make test-browser` | Playwright |
| `make build` | both workspaces |
| `make verify` | lint + typecheck + test + build |

### `make test-e2e` prints two rules first

Both were learned by breaking things:

**Never suspend the default tenant.** It suspends the super-admin who lives in it and 403s every subsequent request; recovery required a direct database update. Create a disposable tenant.

**Give the rate limiter room.** Repeated verification runs have exhausted the budget and produced failures unrelated to the code under test.

### `make test-browser` warns about self-inflicted flakes

Long runs have failed with `ECONNRESET` because editing a backend file triggered nodemon, which restarted the server mid-test. Do not chase a flake until you have confirmed nothing was recompiling.

### `make verify` says what it does not cover

The live E2E suite and the browser suite are **not** in it. A green `verify` is not a green release.

## Images

| Target | Does |
|---|---|
| `make images TAG=<sha>` | builds both |
| `make push TAG=<sha>` | pushes — **refuses `:latest`** |

`make images` reminds you that **`NEXT_PUBLIC_*` values are inlined at build time**: a different API URL, or a tenant-pinned build, is a different image. It takes `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_TENANT_ID` as build args for this reason.

## Deployment

| Target | Does |
|---|---|
| `make deploy ENV=… TAG=…` | preflight → pull → up → wait healthy → postdeploy checklist |
| `make deploy-staging TAG=…` | |
| `make deploy-prod TAG=…` | |
| `make rollback TAG=<previous>` | with a warning, and a confirmation |

### `make preflight`

Runs before any staging or production deploy and **refuses** on:

| Condition | Why |
|---|---|
| `TAG=latest` | a rollback needs something to roll back to |
| `NODE_ENV != production` in prod | it gates CORS, the rate limit (**100,000/15 min outside production**) and error detail |
| `SEED_DEMO=true` | a demo seeder against real data is a data-integrity incident |
| `CORS_ORIGIN=*` | the policy runs with `credentials: true` — a wildcard lets any site make authenticated cross-origin requests |
| `acme-staging` in prod | staging certificates are trusted by **no browser**, and the failure appears in a browser rather than in any log |

Each of these is a configuration mistake that produces a working-looking deployment.

### `make postdeploy`

Prints the verification checklist rather than pretending to run it:

```
[ ] /health returns 200 with database: "connected"
[ ] a user can log in
[ ] a tenant-scoped list returns that tenant's rows AND NO OTHERS
[ ] a certificate issued BEFORE this deploy still verifies at its public URL
[ ] an attachment uploaded before this deploy still downloads
[ ] migrate-status reports nothing unexpected
[ ] schedulers run on EXACTLY ONE instance
```

**The certificate check is the one that catches a deploy that lost a secret.** Without it, a broken configuration looks successful for weeks.

### `make rollback`

Warns before doing anything:

> Application code rolls back cleanly. **Migrations do not.** If this release dropped or renamed anything, the previous code cannot run against this schema — roll forward instead.

That asymmetry is the whole content of [`08-ROLLBACK.md`](./08-ROLLBACK.md).

## Helm

| Target | Does |
|---|---|
| `make helm-lint ENV=… TAG=…` | lints the umbrella chart |
| `make helm-template ENV=… TAG=…` | renders the manifests |
| `make helm-deploy ENV=… TAG=…` | install or upgrade — **refuses `:latest`** |
| `make helm-rollback` | `helm rollback` |

`helm-lint` and `helm-template` are the two that run today. `kubectl apply --dry-run=server` has **not** been run — no cluster has been reachable, so the charts are known to render and not known to deploy.

The chart's own guards fire at render time:

```
missing image.tag              → refuses
cron.enabled + replicaCount>1  → refuses
missing required secret        → refuses
equal JWT secrets              → refuses
production with no corsOrigin  → refuses
```

## Housekeeping

| Target | Does |
|---|---|
| `make clean` | removes build artefacts and `node_modules` |
| `make format` | Prettier across the workspace |

## The Pattern

Every guard in this Makefile refuses **at configuration time** rather than letting something deploy and misbehave quietly.

That is the same reasoning as the Helm render guards, the deny-by-default tenant scope, and the fail-fast on missing secrets: **a failure you notice beats a control that disables itself.**

## Requirements

`make`, `docker` with the compose plugin, `node`, `pnpm`. `helm` and `kubectl` for the Kubernetes targets.

On Windows, `make` is not present by default — install it through Git Bash tooling, Chocolatey, or run inside WSL.
