# 02 — Containerization

Two images, both running a **compiled binary** with no language runtime in the final layer.

---

## Why Binaries

Callibrator is deployed on-premise inside hospital networks. Every additional runtime is a procurement conversation, a patching obligation and an attack surface someone has to sign off.

A single executable plus a reverse proxy is far easier to get through a hospital IT review than "install Node 24 and keep it patched".

## Backend Image

Built from the **repository root** — `docker build -f backend/Dockerfile .` — because the only committed lockfile is the root `package-lock.json` (ADR-044). The context is filtered by `backend/Dockerfile.dockerignore`, an allow-list. Abridged from `backend/Dockerfile`, which is the source of truth:

```dockerfile
# ── builder ──────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci --workspace backend --no-audit --no-fund
COPY backend/ backend/
WORKDIR /app/backend
RUN npm run swagger:generate
RUN npx --no-install pkg . --targets node24-linux-x64 --output /out/backend

# ── runtime ──────────────────────────────────
FROM debian:bookworm-slim
WORKDIR /app
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN set -eux; \
    sed -i 's|http://|https://|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates openssl chromium fonts-liberation wget; \
    rm -rf /var/lib/apt/lists/*
RUN useradd -r -u 997 -s /usr/sbin/nologin app
RUN mkdir -p /app/backup/tenant-backups /app/log /app/uploads/profile /app/uploads/tenant && \
    chown -R app:app /app/backup /app/log /app/uploads
COPY --from=builder /out/backend ./backend
COPY --from=builder /app/backend/swagger.json ./swagger.json
COPY --from=builder /app/backend/src/templates ./src/templates
COPY --from=builder /app/backend/docs ./docs
COPY --from=builder /app/backend/public ./public
ENV NODE_ENV=production APP_STORAGE_PATH=/app \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RUN chmod +x ./backend && chown app:app ./backend
EXPOSE 3000
USER app
CMD ["./backend"]
```

### Five details that will look strange

**1. Debian runtime, not Alpine.** The image needs **Chromium** for certificate PDF rendering, and Alpine Chromium against a glibc-linked pkg binary is a fight not worth having.

**2. `PUPPETEER_SKIP_DOWNLOAD=true` at build.** The packager cannot embed a browser. The runtime uses system Chromium via `PUPPETEER_EXECUTABLE_PATH`.

**3. The CA bundle comes from the builder stage.** Plain HTTP to the Debian mirrors is blocked in the deployment subnet, and `bookworm-slim` ships no CA bundle, so apt over HTTPS cannot verify the mirror. The bundle is copied from `node:24-alpine` (which arrived over the registry's verified TLS) to the path apt reads by default, so **every** apt request is verified; Debian's `ca-certificates` package then regenerates it.

This replaced bootstrapping `ca-certificates` with `Verify-Peer=false` (S-13), which let anything on the build network serve the trust store everything afterwards verified against.

**3a. `npm ci` against the root lockfile.** Dependencies install **hoisted** to `/app/node_modules` — the same tree the tests run against. `pkg.assets` in `backend/package.json` therefore also names `../node_modules/swagger-ui-dist/**/*`; without it the Swagger UI's static files are not embedded. `uploads/**/*` was removed from `pkg.assets`: it embedded whatever developer uploads were on disk into the binary.

**4. Runtime assets are copied explicitly.** `swagger.json`, `src/templates` and `docs/` are read from disk **next to the binary** via `appPath()`, not from the embedded snapshot.

**Omitting any of these produces an API that starts fine and then fails on the first PDF, the first email, or the first documentation page** — failures far from their cause.

**5. `swagger:generate` runs before packaging.** A build that skips it ships a spec describing the previous version.

### Non-root

A dedicated `app` user (uid **997**, pinned) with `/usr/sbin/nologin`. Persistent directories are created and chowned at build, because a container running as non-root cannot create them at runtime: `/app/backup/tenant-backups`, `/app/log`, `/app/uploads/{profile,tenant}`, and — since 2026-09-24 (S-40) — **`/app/storage`** (the `local` storage driver's root) and **`/app/.well-known`** (ACME HTTP-01). S-12 was recorded as done while those two were still neither created nor on a volume.

### Which services are non-root, and what each may do (S-19)

This used to say only "non-root". Precisely, in the compose stack (`deploy/compose/docker-compose.yml`, the `x-hardened` block):

| Service | Runs as | Capabilities | Read-only root | CPU limit (prod) |
|---|---|---|---|---|
| backend | uid 997 (image `USER`) | **none** (`cap_drop: [ALL]`) | no — pkg native-addon extraction and Chromium's profile writes are not mapped yet | 2.0 |
| frontend | uid 1001 (image `USER`) | none | no | 1.0 |
| postgres, redis, rabbitmq, clamav | root **at start**, then their own user (the official entrypoints chown the data directory and drop privileges) | CHOWN, FOWNER, DAC_OVERRIDE, SETUID, SETGID only | redis: **yes** (+ `/tmp` tmpfs) | 2.0 / 0.5 / 1.0 / 1.0 |
| nginx | master root (binds 80/443), workers `nginx` | CHOWN, SETUID, SETGID, NET_BIND_SERVICE, DAC_OVERRIDE | **yes** (tmpfs `/var/cache/nginx`, `/var/run`, `/tmp`) | 0.5 |
| volume-init | root, runs once | CHOWN, FOWNER, DAC_OVERRIDE | — | — |

Every service has `no-new-privileges`. **Not verified by running** — no Docker where it was written; the first `make up` must show every container healthy, and a missing capability appears as an entrypoint "Operation not permitted" in `docker compose logs <service>`.

## Frontend Image

**Build context: the repository root** (S-29, the same shape as the backend under ADR-046):

```bash
docker build -f frontend/Dockerfile .
```

Abridged — [`frontend/Dockerfile`](../../frontend/Dockerfile) is the source:

```dockerfile
FROM node:24.21.0-alpine@sha256:<digest> AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm ci --workspace frontend --no-audit --no-fund
COPY frontend/ frontend/
WORKDIR /app/frontend
RUN npm run build
RUN test -f .next/standalone/frontend/server.js || (echo "ERROR: ..." && exit 1)

FROM node:24.21.0-alpine@sha256:<digest> AS runner
WORKDIR /app
RUN apk add --no-cache wget && addgroup -S -g 1001 app && adduser -S -u 1001 -G app app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=app:app /app/frontend/.next/standalone ./
COPY --from=builder --chown=app:app /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder --chown=app:app /app/frontend/public ./frontend/public
WORKDIR /app/frontend
USER 1001:1001
EXPOSE 3000
HEALTHCHECK ... CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1
CMD ["node", "server.js"]
```

**`npm ci --workspace frontend` against the committed root lockfile** (ADR-044). The previous image ran `npm install` with no lockfile in a `frontend/` context: over 10 minutes, and a different transitive tree on every build. What the root context sends is controlled by [`frontend/Dockerfile.dockerignore`](../../frontend/Dockerfile.dockerignore), an allow-list (the three manifests and `frontend/`, minus `node_modules`, `.next`, local `.env*` files and tests). BuildKit reads `<Dockerfile>.dockerignore` in preference to the context's `.dockerignore`; `frontend/.dockerignore` is not consulted by this build.

**No bun in the image.** `next-bun-compile` (a devDependency) has a postinstall that runs `bun -e` to create a self-symlink used only by the opt-in compiled-binary path. The root `package.json` `allowScripts` denies it, and npm 11 in `node:24` honours that list, so the script does not run. The old image copied bun in only so `npm install` could run that postinstall.

**`next.config.ts` sets `turbopack.root` and `outputFileTracingRoot` to the workspace root.** Under the npm workspace, `next` is hoisted to `<repo>/node_modules`, and Turbopack refuses to resolve outside its root — with root at `frontend/`, `next build` fails with "couldn't find the Next.js package". A consequence: the standalone bundle mirrors the repository layout, so the server is `.next/standalone/frontend/server.js` with the traced `node_modules` beside it, and the runtime `WORKDIR` is `/app/frontend`.

**Both stages pin the base image by version and digest.** A floating tag is a different base on every pull.

**The uid is pinned and `USER` is numeric** (1001). A Kubernetes pod with `runAsNonRoot` refuses an image whose `USER` is a name, and the chart's `runAsUser`/`fsGroup` must name this id.

**The compiled-binary path** in [`../FRONTEND/11-BUILD-AND-BINARY.md`](../FRONTEND/11-BUILD-AND-BINARY.md) remains the intended on-premise distribution format; this image does not build it.

**`HOSTNAME`, not `HOST`.** Next.js standalone `server.js` binds `process.env.HOSTNAME`, and **Docker sets `HOSTNAME` to the container ID**. Unset, the server listens on an address nothing can reach — the healthcheck reports "connection refused" while the process is perfectly healthy. This cost a deployment. `HOST` is read by nothing and is no longer set anywhere — not in the image, compose or the chart (S-30).

**The `test -f .next/standalone/frontend/server.js` line.** It fails the build loudly if the build produced no standalone output. Without it the runner stage copies nothing and the failure surfaces at container start — the same class of problem as a build artefact reporting success and emitting nothing.

**`output: "standalone"` is production-only in `next.config.ts`**, alongside a `next-bun-compile` adapter that is **opt-in behind `NEXT_COMPILE=true`**. Left always-on it breaks `next build` with `ENOENT: .next/next-server.js.nft.json`.

**Overrides are evaluated against the package being installed.** `frontend/package.json` overrode `eslint` to an exact version while also declaring it a direct devDependency. At the workspace root that is fine — the root has no direct `eslint` — so `npm install` succeeded locally and **only the container build failed**, with `EOVERRIDE: Override for eslint@^9.22.0 conflicts with direct dependency`. The override now uses npm's `"$eslint"` reference, which resolves to the direct dependency's version.


**Only `wget` is added to the runtime image** (for the healthcheck). The runtime is Node from the base image running the standalone bundle — not a Bun-compiled binary. Anything else added should be justified.

### `NEXT_PUBLIC_*` is baked in

Inlined at **build** time, not read at runtime.

- A different API URL means a different build.
- A tenant-pinned build (`NEXT_PUBLIC_TENANT_ID`) is a separate image.
- Setting them in the container environment does nothing.

Anything genuinely runtime-configurable must come from the API.

## The `.dockerignore` Trap

**Docker reads `.dockerignore` from the build context root, not from beside the Dockerfile.**

A `.dockerignore` sitting next to a Dockerfile in a subdirectory is **silently ignored**, and the symptom — a slow build, or `node_modules` leaking into the image — points nowhere near the cause.

The one exception is **`<Dockerfile>.dockerignore`**: BuildKit (every `docker build` and `docker compose build` today) reads `backend/Dockerfile.dockerignore` for a build using `backend/Dockerfile`, whatever the context. That is how the backend image — whose context is the repository root — is filtered. `backend/.dockerignore` is **not** consulted by that build.

## Health Checks

| Image | Check | Proves |
|---|---|---|
| Backend | `GET /health` | 200 `{"status":"ok"}`; **503** `{"status":"unavailable"}` when PostgreSQL, Redis or RabbitMQ is unreachable |
| Frontend | `wget --spider :3000` | the server is serving |

`/health` probes the required datastores, so it is a genuine **readiness** probe (the dependency-free liveness probe is `/live`). Using it as a liveness probe would restart a healthy process during a database blip ([`09-KUBERNETES.md`](./09-KUBERNETES.md)).

A frontend that is healthy while the API is down is correct: it renders error states, which is the right behaviour.

## Compose Service Images — every third-party image pinned (P7-07)

Pinned **by version and digest** on 2026-09-24 (digests read from Docker Hub's registry API; manifest-list digests, so every architecture resolves to the same pinned index):

| Service | Image | Pin |
|---|---|---|
| backend builder | `node:24.21.0-alpine` | `@sha256:ebfe2f90…c1c1` (same as the frontend) |
| backend runtime | `debian:bookworm-slim` | `@sha256:3783cc01…6251` |
| frontend (both stages) | `node:24.21.0-alpine` | `@sha256:ebfe2f90…c1c1` |
| postgres | **`pgvector/pgvector:pg18`** — plain `postgres:18-alpine` lacks the `vector` extension; migration `0018` fails | `@sha256:2ba9ca5f…67e7a` |
| redis | `redis:8.6-alpine` | `@sha256:bb2e2e3a…de67` |
| rabbitmq | `rabbitmq:3.13-management-alpine` — the management UI is worth the size on-premise | `@sha256:606d8c0d…e281` |
| clamav | `clamav/clamav:1.4` — the image S-04's client was verified against | `@sha256:a5f03c12…9303` |
| nginx | `nginx:1.27-alpine` | `@sha256:65645c7b…2a10` |
| volume-init | `alpine:3.20` | `@sha256:d9e853e8…b6bc` |
| pgadmin (dev) | `dpage/pgadmin4:8.14` | `@sha256:8a68677a…be7` |
| minio (dev) | `minio/minio:RELEASE.2024-11-07T00-52-20Z` | release tag (immutable by MinIO's convention); not digest-pinned |
| vector (optional shipper) | `timberio/vector:0.58.0-alpine` | version only — pin the digest on first pull |

The two `:latest` tags T42 named were in **`backend/docker-compose.yaml`** (the source-checkout datastores file) — `clamav/clamav:latest` and `dpage/pgadmin4:latest` — and `frontend/docker-compose.yaml` used `nginx:stable-alpine`. All three now match the table. The full digests are in the files.

### Moving a pinned base image

A digest moves **deliberately**, as a reviewed change — never as a side effect of a rebuild.

1. Read the new digest from the registry (`docker buildx imagetools inspect <image>:<tag>`, or `docker pull` then `docker inspect --format '{{index .RepoDigests 0}}'`).
2. Change it in **every** file that names the image — `grep -rn '<image>:' deploy backend frontend .github` — including the CI service containers in `.github/workflows/ci.yml`, which use the deployment's images on purpose.
3. For postgres, read the minor-version release notes (a `pg18` digest bump can be an 18.x minor upgrade). For clamav, re-run the EICAR check S-04 used.
4. Let CI run: `boot-and-migrate` boots on the new postgres/redis/rabbitmq images. Record the move in the change record.

Security updates arrive the same way: a base-image advisory is a digest bump, reviewed like any other change.

## Volumes

| Volume | Holds | Losing it means |
|---|---|---|
| `./volumes/postgres` | the database | everything |
| `./volumes/redis` | rate-limit counters, WebAuthn challenges, OIDC state, caches | sign-ins in progress fail; lockout counters reset |
| `./volumes/rabbitmq` | queued messages | queued work |
| `./volumes/clamav` | signature database | a slow first boot |
| `./volumes/uploads` | attachments and the upload quarantine (always local disk — the attachment path does not use the storage module) | files |
| `./volumes/storage` | the `local` storage driver's objects (S-40) | stored objects |
| `./volumes/well-known` | ACME HTTP-01 challenges (S-40) | a validation in flight (it retries) |
| `./volumes/backup` | tenant backups + `last-scheduled-backup.json` | restorable tenant backups |
| `./volumes/log` | log files when `LOG_TO_FILE=true`, and `log/jobs/*.json` — scheduled-job status (P7-02) | the missed-run memory across a restart |

`./volumes/redis` matters more than it looks.

## Startup Ordering

`depends_on` with **conditions**, not bare service names — the backend runs `db.sync()` and migrations at boot.

| Dependency | Condition | Why |
|---|---|---|
| postgres | `service_healthy` | `pg_isready` — accepting connections, not merely started |
| redis | `service_healthy` | connected at boot |
| rabbitmq | `service_healthy` | **`check_port_connectivity`**, not `ping` — `ping` only proves the Erlang node is up |
| clamav | `service_started` | first-run `freshclam` takes minutes; scanning is optional |

Requiring ClamAV to be healthy would block the whole stack on an optional component at every cold start. Requiring Postgres to be merely started produces a crash loop that looks like a code fault.

## Image Hygiene

- multi-stage everywhere; build tooling never reaches the runtime layer
- non-root, no capabilities beyond the entrypoint's, `no-new-privileges` (S-19, table above)
- every base image pinned by digest (P7-07); moving one is a reviewed change
- no secrets in the image; configuration arrives at runtime
- scan images for advisories before promoting
