# 02 — Containerization

Two images, both running a **compiled binary** with no language runtime in the final layer.

---

## Why Binaries

Callibrator is deployed on-premise inside hospital networks. Every additional runtime is a procurement conversation, a patching obligation and an attack surface someone has to sign off.

A single executable plus a reverse proxy is far easier to get through a hospital IT review than "install Node 24 and keep it patched".

## Backend Image

```dockerfile
# ── builder ──────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install
COPY . .
RUN npm run swagger:generate
RUN npx @yao-pkg/pkg . --targets node24-linux-x64 --output /app/backend

# ── runtime ──────────────────────────────────
FROM debian:bookworm-slim
WORKDIR /app
RUN set -eux; \
    sed -i 's|http://|https://|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    apt-get -o Acquire::https::Verify-Peer=false update; \
    apt-get -o Acquire::https::Verify-Peer=false install -y --no-install-recommends ca-certificates; \
    apt-get update; \
    apt-get install -y --no-install-recommends openssl chromium fonts-liberation; \
    rm -rf /var/lib/apt/lists/*
RUN useradd -r -s /usr/sbin/nologin app
RUN mkdir -p /app/backup/tenant-backups /app/log /app/uploads/profile /app/uploads/tenant && \
    chown -R app:app /app/backup /app/log /app/uploads
COPY --from=builder /app/backend ./backend
COPY --from=builder /app/swagger.json ./swagger.json
COPY --from=builder /app/src/templates ./src/templates
COPY --from=builder /app/docs ./docs
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

**3. The apt HTTPS dance.** Plain HTTP to the Debian mirrors is blocked in the deployment subnet, and `bookworm-slim` ships no CA bundle yet. So: point apt at HTTPS, bootstrap `ca-certificates` with peer verification disabled **for that one step**, then install everything else with verification back on.

Ugly, deliberate, and documented so nobody "cleans it up".

**4. Runtime assets are copied explicitly.** `swagger.json`, `src/templates` and `docs/` are read from disk **next to the binary** via `appPath()`, not from the embedded snapshot.

**Omitting any of these produces an API that starts fine and then fails on the first PDF, the first email, or the first documentation page** — failures far from their cause.

**5. `swagger:generate` runs before packaging.** A build that skips it ships a spec describing the previous version.

### Non-root

A dedicated `app` user with `/usr/sbin/nologin`. Persistent directories are created and chowned at build, because a container running as non-root cannot create them at runtime.

## Frontend Image

```dockerfile
FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build:docker
RUN ls -lah /app/server            # fail loudly if compilation produced nothing

FROM alpine:3.22 AS runner
WORKDIR /app
RUN apk add --no-cache libstdc++ libc6-compat wget
COPY --from=builder /app/server ./server
RUN chmod +x ./server
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1
CMD ["./server"]
```

**`--frozen-lockfile`.** A build that silently resolves a different dependency version than the one tested ships something nobody tested.

**The `ls -lah /app/server` line.** It fails the build loudly if compilation produced nothing. Without it the next stage copies a missing file and the failure surfaces at container start — the same class of problem as a stale build artefact reporting success and emitting nothing.

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

## Health Checks

| Image | Check | Proves |
|---|---|---|
| Backend | `GET /health` | 200 with `database: "connected"`; **503** when the database is unreachable |
| Frontend | `wget --spider :3000` | the server is serving |

`/health` calls `db.authenticate()`, so it is a genuine **readiness** probe. Using it as a liveness probe would restart a healthy process during a database blip ([`09-KUBERNETES.md`](./09-KUBERNETES.md)).

A frontend that is healthy while the API is down is correct: it renders error states, which is the right behaviour.

## Compose Service Images

| Service | Image | Why not the obvious one |
|---|---|---|
| postgres | **`pgvector/pgvector:pg17`** | plain `postgres:17-alpine` lacks the `vector` extension; migration `0018` fails |
| redis | `redis:8.6-alpine` | |
| rabbitmq | `rabbitmq:3.13-management-alpine` | the management UI is worth the size on-premise |
| clamav | `clamav/clamav:latest` | **unpinned** — see below |
| pgadmin | `dpage/pgadmin4:latest` | **unpinned**, development only |

Two `:latest` tags are a supply-chain risk (T42). Pinning them is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

## Volumes

| Volume | Holds | Losing it means |
|---|---|---|
| `./data/postgres` | the database | everything |
| `./data/redis` | rate-limit counters, **idempotency claims** | duplicate side effects for anything in flight |
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
