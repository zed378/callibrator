# Callibrator frontend — Next.js 16 production image.
#
# ---------------------------------------------------------------------------
# BUILD CONTEXT: THE REPOSITORY ROOT, not frontend/   (S-29, ADR-046)
#
#   docker build -f frontend/Dockerfile .
#
# The only committed lockfile is the WORKSPACE ROOT's package-lock.json
# (ADR-044). A build whose context is frontend/ cannot see it, so it could only
# `npm install` — resolving every transitive version afresh, and taking 10+
# minutes doing it. With the root as context, `npm ci --workspace frontend`
# installs exactly the committed tree, the same one the test suite runs on.
#
# What is sent is controlled by frontend/Dockerfile.dockerignore (BuildKit reads
# <Dockerfile>.dockerignore in preference to <context>/.dockerignore). It
# allow-lists the three manifests and frontend/, and keeps node_modules, .next,
# local .env files and tests out of the builder.
#
# This build uses `output: "standalone"` (next.config.ts enables it for
# production) and runs the result on Node. The compiled-binary path
# (next-bun-compile, docs/FRONTEND/11-BUILD-AND-BINARY.md) is NOT built here.
# ---------------------------------------------------------------------------

# =========================
# Stage 1: build
# =========================
# Pinned by version AND digest: a floating tag is a different base on every
# pull. Bump both together.
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS builder

WORKDIR /app

# The workspace manifests, and the lockfile that pins them. backend/package.json
# is needed only so the lockfile's workspace entries match — `npm ci` refuses a
# lockfile that disagrees with the manifests. Its dependencies are not installed.
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json

# Install exactly the committed tree, frontend workspace only, hoisted to
# /app/node_modules — the layout every local build and test run sees.
#
# next-bun-compile: its postinstall runs `bun -e` to create a self-symlink that
# only the opt-in compiled-binary path (NEXT_COMPILE=true) uses. The root
# package.json `allowScripts` DENIES it, and npm 11 honours that list, so the
# script does not run and bun is not needed in this image. (The previous
# Dockerfile copied bun in only to let that postinstall succeed under a plain
# `npm install`.)
RUN npm ci --workspace frontend --no-audit --no-fund

COPY frontend/ frontend/

WORKDIR /app/frontend

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
#
# The path is .next/standalone/FRONTEND/server.js because next.config.ts sets
# outputFileTracingRoot to the workspace root: the bundle mirrors the repo
# layout, with the traced (hoisted) node_modules at .next/standalone/node_modules.
RUN test -f .next/standalone/frontend/server.js \
    || (echo "ERROR: .next/standalone/frontend/server.js missing — is output:'standalone' still set, and outputFileTracingRoot still the workspace root, in next.config.ts?" && ls -la .next .next/standalone && exit 1)

# =========================
# Stage 2: runtime
# =========================
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runner

WORKDIR /app

# The uid/gid are PINNED and USER is numeric: a Kubernetes pod with
# runAsNonRoot refuses an image whose USER is a name it cannot verify, and the
# Helm chart's runAsUser/fsGroup must name this exact id
# (deploy/helm/callibrator/charts/frontend/values.yaml).
RUN apk add --no-cache wget \
    && addgroup -S -g 1001 app && adduser -S -u 1001 -G app app

# HOSTNAME, not HOST. Next.js standalone server.js binds to
# process.env.HOSTNAME, and Docker sets HOSTNAME to the container ID by
# default - so the server listens on the container hostname only and
# http://localhost:3000 is refused. The app still serves over the network,
# which makes the healthcheck fail while everything else looks fine.
# HOST is not read by Next and is deliberately not set (S-30).
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

# The standalone bundle (workspace layout: /app/node_modules + /app/frontend),
# plus the two directories it does not include.
COPY --from=builder --chown=app:app /app/frontend/.next/standalone ./
COPY --from=builder --chown=app:app /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder --chown=app:app /app/frontend/public ./frontend/public

WORKDIR /app/frontend

USER 1001:1001

EXPOSE 3000

# Proves the server is serving. It does NOT prove the API is reachable — that
# is the backend's /health, which returns 503 when the database is unreachable.
# A frontend that is healthy while the API is down is correct: it renders
# error states.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1

CMD ["node", "server.js"]
