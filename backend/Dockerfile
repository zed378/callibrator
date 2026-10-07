# ==========================================
# BUILD CONTEXT: THE REPOSITORY ROOT, not backend/
#
#   docker build -f backend/Dockerfile .
#
# The only committed lockfile is the WORKSPACE ROOT's package-lock.json
# (ADR-044); backend/package-lock.json is deliberately git-ignored. A build
# whose context is backend/ cannot see the lockfile, so it can only
# `npm install` — resolving every transitive version afresh on every build
# (S-13). The context is the root so `npm ci` can honour the committed tree.
#
# What is sent is controlled by backend/Dockerfile.dockerignore (BuildKit reads
# <Dockerfile>.dockerignore in preference to <context>/.dockerignore). It
# allow-lists the three manifests and backend/, and keeps developer uploads,
# local.env, tests and coverage out of the builder.
# ==========================================

# ==========================================
# STAGE 0 — PKG BASE BINARY (A-325)
# ==========================================
#
# `pkg` wraps the app around a prebuilt Node base binary (~80 MB) that
# @yao-pkg/pkg-fetch downloads from its GitHub release on every uncached build.
# When that download failed (a network error, or a stall on a loaded host), pkg
# fell back to compiling Node from source, which it refuses on Alpine, and the
# image could not be built at all (three failures on 2026-09-30).
#
# So the binary is fetched HERE, in a stage that depends only on the pins below:
# a source change never re-downloads it, the fetch retries with a timeout, and
# the file must match the PINNED sha256 or the build stops. The builder hands it
# to pkg through PKG_CACHE_PATH, where pkg-fetch looks before downloading.
#
# The pins are pkg-fetch's own: the release tag from its version
# (v<major>.<minor>), the newest node26 its patches.json knows, and the sha256
# its expected-shas.json lists. tests/guards/pkgBasePin.a325.guard.test.ts fails
# when a pkg-fetch upgrade moves any of them, so the pin cannot drift silently.
#
# PKG_BASE_URL overrides only WHERE the file comes from (an internal mirror, a
# file server for an offline build); the checksum still decides whether it is used.
FROM node:26.10.0-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS pkg-base
ARG PKG_BASE_TAG=v3.6
ARG PKG_BASE_NAME=node-v26.5.1-linux-x64
ARG PKG_BASE_SHA256=02b77b99449f9781b88698a94bdb7dd5e396c75eacc977639591d69a72c9e436
ARG PKG_BASE_URL=https://github.com/yao-pkg/pkg-fetch/releases/download/${PKG_BASE_TAG}/${PKG_BASE_NAME}
RUN set -eu; \
    ok=""; \
    for attempt in 1 2 3 4 5; do \
      if wget -q -T 60 -O /tmp/pkg-base "${PKG_BASE_URL}"; then ok=1; break; fi; \
      echo "pkg base: download attempt ${attempt} failed; retrying"; \
      rm -f /tmp/pkg-base; sleep $((attempt * 5)); \
    done; \
    [ -n "${ok}" ] || { echo "pkg base: ${PKG_BASE_URL} could not be downloaded"; exit 1; }; \
    echo "${PKG_BASE_SHA256}  /tmp/pkg-base" | sha256sum -c - \
      || { echo "pkg base: sha256 mismatch for ${PKG_BASE_NAME} (pinned ${PKG_BASE_SHA256})"; exit 1; }; \
    mkdir -p "/pkg-cache/${PKG_BASE_TAG}"; \
    mv /tmp/pkg-base "/pkg-cache/${PKG_BASE_TAG}/fetched-${PKG_BASE_NAME#node-}"; \
    chmod 0755 "/pkg-cache/${PKG_BASE_TAG}/fetched-${PKG_BASE_NAME#node-}"

# ==========================================
# STAGE 1 — BUILDER
# ==========================================

# P7-07: pinned by version AND digest — the same image frontend/Dockerfile
# uses (node:26.10.0-alpine resolved to this digest on 2026-09-27, ADR-076). A floating tag
# changes the toolchain under an unchanged commit. How to move it:
# docs/DEVOPS/02-CONTAINERIZATION.md § Moving a pinned base image.
FROM node:26.10.0-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS builder

WORKDIR /app

# The workspace manifests, and the lockfile that pins them. frontend/package.json
# is needed only so the lockfile's workspace entries match — `npm ci` refuses a
# lockfile that disagrees with the manifests. Its dependencies are not installed.
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
# P9-22 (ADR-097): the shared request schemas, a workspace the backend depends
# on. `npm ci` links it, so its manifest must be here before the install.
COPY packages/contracts/package.json packages/contracts/package.json

# puppeteer is a backend DEVdependency (the documentation generators and the
# browser smoke suite use it); nothing here needs its Chromium download.
# M-11 (ADR-095): the backend renders no PDF, so the runtime has no browser.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Install exactly the committed tree, backend workspace only. Dependencies are
# HOISTED to /app/node_modules, which is also how every test run and the lint
# gate see them.
RUN npm ci --workspace backend --no-audit --no-fund

# Copy source code
COPY backend/ backend/
# The contracts source: the validators re-export it, and build:dist compiles it
# to CommonJS in dist/node_modules/@callibrator/contracts, which pkg packages.
COPY packages/contracts/ packages/contracts/

WORKDIR /app/backend

# P9-25 (ADR-103): the API contract is backend/openapi.json, generated by
# `npm run openapi:generate` and COMMITTED; the image ships the committed file.
# Refuse to build an image whose contract is stale against its own source.
RUN npm run openapi:check

# P9 (ADR-087): package.json's `bin` is dist/index.js — the JavaScript copied
# and the TypeScript compiled (TypeScript 7, ADR-076) by scripts/build-dist.ts.
# Without this step pkg refuses: "Bin file does not exist".
RUN npm run build:dist

# Build standalone Linux binary. @yao-pkg/pkg is a backend devDependency, so
# npx runs the locked version rather than fetching one. Its base binary is the
# checksum-verified one from the pkg-base stage (A-325), never a download here.
COPY --from=pkg-base /pkg-cache /tmp/pkg-cache
RUN PKG_CACHE_PATH=/tmp/pkg-cache npx --no-install pkg . \
    --targets node26-linux-x64 \
    --output /out/backend

# ==========================================
# STAGE 2 — RUNTIME
# ==========================================

# P7-07: pinned by digest (bookworm-slim on 2026-09-24). Debian point releases
# and security updates arrive by MOVING this digest deliberately, not by a
# rebuild picking up whatever the tag points at that day.
FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251

WORKDIR /app

# Runtime dependencies. No browser: since M-11 (ADR-095) certificate PDFs are
# rendered by the frontend from GET /certificates/:id/document, so chromium and
# its fonts left the image (and with them PUPPETEER_EXECUTABLE_PATH).
#
# Plain HTTP (port 80) to the Debian mirrors is blocked in the deployment
# subnet, so point apt at HTTPS. bookworm-slim ships no CA bundle, so apt could
# not verify the mirror. The previous fix disabled peer verification to fetch
# ca-certificates — which let anything on the build network serve the trust
# store everything afterwards verifies against (S-13).
#
# Instead, seed the bundle from the builder stage (node:26-alpine ships
# /etc/ssl/certs/ca-certificates.crt, and that image arrived over the
# registry's own verified TLS). apt's HTTPS transport reads exactly that path by
# default, so EVERY apt request below is verified. Installing Debian's
# ca-certificates package then regenerates the bundle from Debian's own set.
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
#
# rsync, openssh-client (ssh, ssh-keyscan) and sshpass: the upstream image
# import (services/upstreamFileImport, the ADR "rsync image import") copies the
# upstream server's device photos over rsync/SSH. The backend spawns them with
# fixed argument vectors, never a shell; sshpass reads the password from its
# environment (SSHPASS), never argv. --no-install-recommends keeps xauth and
# the rest of openssh-client's recommends out.
RUN set -eux; \
    sed -i 's|http://|https://|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    sed -i 's|http://|https://|g' /etc/apt/sources.list 2>/dev/null || true; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        openssl \
        wget \
        rsync \
        openssh-client \
        sshpass; \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
# The uid is PINNED. `useradd -r` alone takes whatever system uid the base
# image happens to leave free — 997 today, not guaranteed tomorrow — and the
# compose stack's volume-init service must chown the bind mounts to this exact
# number. An unpinned uid would make a base-image bump a silent crash loop.
RUN useradd -r -u 997 -s /usr/sbin/nologin app

# Create persistent storage directories.
#
# /app/storage (the `local` storage driver's root, services/storage/
# config.service.js) and /app/.well-known (ACME HTTP-01 challenges) since
# S-40: S-12 was marked done, but neither was created, so the first write to
# either failed EACCES under the root-owned /app. They are volumes in compose
# and in the chart; creating them here is what makes an unmounted run work.
#
# /app/exports since P6-02 (ADR-077): GDPR data exports (gdpr.service
# #exportUserData, storagePath("exports")). It was never created, so every
# POST /gdpr/export failed EACCES under the root-owned /app and answered 500,
# which the E2E spec and docs/TESTING/03 had filed as "no provider configured".
# Exports are short-lived and purged (purgeExpiredExports), so it is not a
# volume: a recreate drops pending downloads, which is the accepted cost.
#
# /app/.bootstrap since P10-16 (ADR-099): the first super admin's one-time
# password file (utils/bootstrapSecret.util.ts), readable ONLY from inside the
# container (`docker exec <backend> cat /app/.bootstrap/superadmin-password`).
# Owner-only (0700), and deliberately NOT a volume in compose or Helm: a bind
# mount would put the plaintext on the host. It is gone on a recreate, which is
# the point; a lost one is re-issued by `./backend rotate-bootstrap-password`.
RUN mkdir -p /app/backup/tenant-backups /app/log /app/uploads/profile /app/uploads/tenant \
        /app/storage /app/.well-known /app/exports /app/.bootstrap && \
    chown -R app:app /app/backup /app/log /app/uploads /app/storage /app/.well-known /app/exports \
        /app/.bootstrap && \
    chmod 0700 /app/.bootstrap

# Copy binary
COPY --from=builder /out/backend ./backend

# Runtime assets read via appPath() (execPath-relative → /app). These are read
# from disk next to the binary, not from the embedded snapshot, so they must be
# shipped: the API spec, the email HTML templates, and the docs
# pages served at /documentation, /standards, /tab-permissions.
COPY --from=builder /app/backend/openapi.json ./openapi.json
# P9-25 (ADR-103): Scalar's standalone bundle for the signed-in reference at
# /docs — self-hosted (no CDN under the docs CSP), read via appPath like the spec.
COPY --from=builder /app/node_modules/@scalar/api-reference/dist/browser/standalone.js ./docs-ui/scalar.standalone.js
COPY --from=builder /app/backend/src/templates ./src/templates
COPY --from=builder /app/backend/docs ./docs
# index.js mounts express.static(appPath("public")) at /public, and this COPY
# was missing — so every request under /public answered 404 in every container
# while working fine from a source checkout.
COPY --from=builder /app/backend/public ./public

# Environment
ENV NODE_ENV=production
ENV APP_STORAGE_PATH=/app

# Binary permissions
RUN chmod +x ./backend && \
    chown app:app ./backend

# Expose port
EXPOSE 3000

# Run as non-root
USER app

# Start application
CMD ["./backend"]