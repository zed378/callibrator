# Callibrator frontend — Next.js 16 production image.
#
# ---------------------------------------------------------------------------
# WHY THIS REPLACED THE BUN-COMPILE DOCKERFILE
#
# The previous version could not build. It referenced two things that do not
# exist in this repository:
#
#   COPY package.json bun.lock ./    <- frontend/bun.lock is not committed
#   RUN bun run build:docker         <- package.json has no "build:docker"
#                                       script (only build, compile, build:binary)
#
# Both fail at `docker build`, so the image was never producible from a clean
# checkout.
#
# This build uses `output: "standalone"`, which next.config.ts already enables
# for production, and runs the result on Node. The standalone bundle carries
# only the dependencies actually imported, so the runtime image stays small
# without the bun-compile step.
#
# The compiled-binary path (docs/FRONTEND/11-BUILD-AND-BINARY.md) is still the
# intended distribution format for on-premise installs. Restoring it needs a
# committed lockfile and a real build script; until then this is what builds.
# ---------------------------------------------------------------------------

# =========================
# Stage 1: build
# =========================
FROM node:22-alpine AS builder

WORKDIR /app

# next-bun-compile is a devDependency whose postinstall shells out to `bun`
# purely to create a symlink:
#   sh -c bun -e "try{require(fs).symlinkSync(..,node_modules/next-bun-compile)}catch{}"
# Without bun on PATH that exits 127 and `npm install` fails before the build
# starts. The adapter itself is NOT used by this image (next.config.ts gates it
# behind NEXT_COMPILE=true), but the package is still installed, so its
# postinstall has to be able to run.
COPY --from=oven/bun:1-alpine /usr/local/bin/bun /usr/local/bin/bun

# No lockfile is committed, so this resolves fresh on every build. That is a
# real reproducibility gap: a build today and a build next month can ship
# different transitive versions. Committing a lockfile is the fix.
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .

# NEXT_PUBLIC_* values are INLINED AT BUILD TIME, not read at runtime.
# A different API URL, or a tenant-pinned build, is a DIFFERENT IMAGE.
#
# NEXT_PUBLIC_API_BASE_URL is used in two places at once:
#   - server-side, by the proxy at src/app/api/v1/[...path]/route.ts
#   - client-side, by Socket.IO in src/lib/socket.ts
# so it must be reachable from the browser AND from inside this container.
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_TENANT_ID
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_TENANT_ID=$NEXT_PUBLIC_TENANT_ID \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Fail loudly here rather than copying nothing and failing at container start,
# far from the cause. A build that reports success and emits nothing is the
# failure mode this line exists to catch.
RUN test -f .next/standalone/server.js \
    || (echo "ERROR: .next/standalone/server.js missing — is output:'standalone' still set in next.config.ts?" && ls -la .next && exit 1)

# =========================
# Stage 2: runtime
# =========================
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache wget \
    && addgroup -S app && adduser -S -G app app

# HOSTNAME, not HOST. Next.js standalone server.js binds to
# process.env.HOSTNAME, and Docker sets HOSTNAME to the container ID by
# default - so the server listens on the container hostname only and
# http://localhost:3000 is refused. The app still serves over the network,
# which makes the healthcheck fail while everything else looks fine.
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    HOST=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

# The standalone bundle, plus the two directories it does not include.
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public

USER app

EXPOSE 3000

# Proves the server is serving. It does NOT prove the API is reachable — that
# is the backend's /health, which returns 503 when the database is unreachable.
# A frontend that is healthy while the API is down is correct: it renders
# error states.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1

CMD ["node", "server.js"]
