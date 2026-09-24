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

A dedicated `app` user with `/usr/sbin/nologin`. Persistent directories are created and chowned at build, because a container running as non-root cannot create them at runtime.

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

## Compose Service Images

| Service | Image | Why not the obvious one |
|---|---|---|
| postgres | **`pgvector/pgvector:pg18`** | plain `postgres:18-alpine` lacks the `vector` extension; migration `0018` fails |
| redis | `redis:8.6-alpine` | |
| rabbitmq | `rabbitmq:3.13-management-alpine` | the management UI is worth the size on-premise |
| clamav | `clamav/clamav:latest` | **unpinned** — see below |
| pgadmin | `dpage/pgadmin4:latest` | **unpinned**, development only |

Two `:latest` tags are a supply-chain risk (T42). Pinning them is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

## Volumes

| Volume | Holds | Losing it means |
|---|---|---|
| `./data/postgres` | the database | everything |
| `./data/redis` | rate-limit counters, WebAuthn challenges, OIDC state, caches | sign-ins in progress fail; lockout counters reset |
| `./data/rabbitmq` | queued messages | queued work |
| `./data/clamav` | signature database | a slow first boot |
| `./uploads` | attachments when `STORAGE_DRIVER=local` | files |
| `./backup` | tenant backups | |
| `./log` | application logs | |

`./data/redis` matters more than it looks.

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
- non-root
- pin every base tag — the two `:latest` above are outstanding
- no secrets in the image; configuration arrives at runtime
- scan images for advisories before promoting
