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

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
# next-bun-compile's postinstall shells out to `bun` to create a symlink.
# Without it on PATH, `npm install` exits 127 with "sh: bun: not found".
COPY --from=oven/bun:1-alpine /usr/local/bin/bun /usr/local/bin/bun
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
RUN test -f .next/standalone/server.js || (echo "ERROR: no standalone output" && exit 1)

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache wget && addgroup -S app && adduser -S -G app app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 HOST=0.0.0.0 PORT=3000
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3   CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1
CMD ["node", "server.js"]
```

**This replaced a Dockerfile that could not build.** The previous version — which is what this document described until 2026-09 — copied a `bun.lock` that is not committed and ran a `build:docker` script that does not exist in `package.json`. The image was never producible from a clean checkout. The compiled-binary path in [`../FRONTEND/11-BUILD-AND-BINARY.md`](../FRONTEND/11-BUILD-AND-BINARY.md) remains the intended on-premise distribution format; restoring it needs a committed lockfile and a real build script.

**`HOSTNAME`, not `HOST`.** Next.js standalone `server.js` binds `process.env.HOSTNAME`, and **Docker sets `HOSTNAME` to the container ID**. Unset, the server listens on an address nothing can reach — the healthcheck reports "connection refused" while the process is perfectly healthy. This cost a deployment.

**No lockfile is copied, because none is committed.** `.gitignore` excludes `pnpm-lock.yaml`, `package-lock.json` and `bun.lock`, so every build resolves transitive versions fresh. **A build today and a build next month can ship different dependencies** — the exact failure `--frozen-lockfile` existed to prevent. Committing a lockfile is the fix; until then this is a known reproducibility gap, recorded as W-11.

**The `test -f .next/standalone/server.js` line.** It fails the build loudly if the build produced no standalone output. Without it the runner stage copies nothing and the failure surfaces at container start — the same class of problem as a build artefact reporting success and emitting nothing.

**`output: "standalone"` is production-only in `next.config.ts`**, alongside a `next-bun-compile` adapter that is **opt-in behind `NEXT_COMPILE=true`**. Left always-on it breaks `next build` with `ENOENT: .next/next-server.js.nft.json`.

**Overrides are evaluated against the package being installed.** `frontend/package.json` overrode `eslint` to an exact version while also declaring it a direct devDependency. At the workspace root that is fine — the root has no direct `eslint` — so `npm install` succeeded locally and **only the container build failed**, with `EOVERRIDE: Override for eslint@^9.22.0 conflicts with direct dependency`. The override now uses npm's `"$eslint"` reference, which resolves to the direct dependency's version.


**Only `libstdc++`, `libc6-compat` and `wget`.** The Bun-compiled binary needs the first two; there is no Node in the final image. Anything else added should be justified.

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
