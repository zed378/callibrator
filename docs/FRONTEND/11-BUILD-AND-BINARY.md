# 11 — Build and Binary Distribution

The frontend compiles to a **standalone Linux binary**. The production image contains no Node runtime.

---

## Why

Callibrator is deployed on-premise inside hospital networks. Every additional runtime is a procurement conversation, a patching obligation and an attack surface someone has to sign off.

A single executable and a reverse proxy is a much easier thing to get through a hospital IT review than "install Node 24 and keep it patched".

The backend does the same thing with `@yao-pkg/pkg` ([`../DEVOPS/02-CONTAINERIZATION.md`](../DEVOPS/02-CONTAINERIZATION.md)).

## Commands

| Command | Output |
|---|---|
| `npm run dev` | Next dev server |
| `npm run build` | `.next` — standard Next output |
| `npm run compile` | `dist/` standalone binary via `next-bun-compile` |
| `npm run build:binary` | build, then compile |
| `npm run start` | `next start` from `.next` |

`next-bun-compile` targets `bun-linux-musl-x64`, which is what allows the Alpine runtime image.

## The Docker Build

```dockerfile
# stage 1 — build and compile
FROM oven/bun:1-alpine AS builder
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build:docker
RUN ls -lah /app/server          # verify the binary exists

# stage 2 — runtime
FROM alpine:3.22 AS runner
RUN apk add --no-cache libstdc++ libc6-compat wget
COPY --from=builder /app/server ./server
RUN chmod +x ./server
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
HEALTHCHECK CMD wget --spider http://localhost:3000 || exit 1
CMD ["./server"]
```

Three details worth understanding:

**`--frozen-lockfile`.** A build that silently resolves a different dependency version than the one tested is a build that ships something nobody tested.

**The `ls -lah /app/server` line.** It fails the build loudly if compilation produced nothing. Without it the next stage copies a missing file and the failure surfaces at container start, far from its cause — which is exactly the class of problem a stale build artefact produces.

**`libstdc++` and `libc6-compat` only.** The Bun-compiled binary needs these; it does not need Node. Anything else added to the runtime image should be justified.

## Environment Variables Are Baked In

This is the constraint that surprises people.

**`NEXT_PUBLIC_*` variables are inlined at build time.** They are not read at runtime.

| Variable | Effect |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | where the client calls |
| `NEXT_PUBLIC_API_VERSION` | |
| `NEXT_PUBLIC_APP_NAME`, `_APP_VERSION` | |
| `NEXT_PUBLIC_AUTH_ENABLED` | |
| `NEXT_PUBLIC_ITEMS_PER_PAGE` | |
| **`NEXT_PUBLIC_TENANT_ID`** | pins the build to one tenant |

Consequences:

- **A different API URL means a different build.** Setting `NEXT_PUBLIC_API_BASE_URL` in the container environment does nothing.
- **A tenant-pinned build is a separate image.** One backend, many branded frontends, each built with its own `NEXT_PUBLIC_TENANT_ID`.
- Anything genuinely runtime-configurable must come from the **API**, not from the environment.

Server-side runtime variables (`HOST`, `PORT`, `NODE_ENV`) are read normally.

## Tenant-Pinned Builds

```
NEXT_PUBLIC_TENANT_ID=<uuid>   → single-tenant branded frontend
NEXT_PUBLIC_TENANT_ID=         → default multi-tenant build
```

A pinned build:

1. fetches branding from the **unauthenticated** `GET /api/v1/tenants/public` before sign-in, so the login page is already branded;
2. sends `X-Tenant-ID` on every API call.

That endpoint exposes branding only — name, logo, primary colour. Anything else on it is a pre-auth disclosure.

## Health Check

```
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3
  CMD wget --spider http://localhost:3000
```

Proves the server is serving. It does **not** prove the API is reachable — that is the backend's `/health`, which calls `db.authenticate()` and returns 503 when the database is unreachable.

A frontend that is healthy while the API is down is correct: it will render error states, which is the right behaviour.

## Reverse Proxy

nginx routes everything not matching `/api`, `/socket.io`, `/oidc` or `/.well-known` to the frontend.

`/socket.io/*` needs the **WebSocket upgrade headers**. Without them Socket.IO falls back to long-polling — which works well enough that nobody notices until connection counts matter. It is the deployment mistake most likely to go undetected ([`../DEVOPS/03-REVERSE-PROXY.md`](../DEVOPS/03-REVERSE-PROXY.md)).

## Local Development on Windows

`npm run dev` failing with `EACCES` on port 3000 is **not** a port-in-use problem. It is the WinNAT reserved port range.

```bash
# elevated prompt
net stop winnat && net start winnat

# or simply
npx next dev -p 4000
```

Hunting for the process holding port 3000 will not find one, which is what makes this cost an hour the first time.

## Build Checklist

- [ ] `pnpm lint` — React Compiler rules included, not disabled
- [ ] `pnpm typecheck`
- [ ] `pnpm test` at the 70% gate
- [ ] `pnpm build`
- [ ] `NEXT_PUBLIC_*` values correct **for this environment** — they are baked in
- [ ] the compiled binary exists and is executable
- [ ] the image starts and answers its health check
- [ ] a tenant-pinned build renders that tenant's branding on the login page
