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
# STAGE 1 — BUILDER
# ==========================================

# P7-07: pinned by version AND digest — the same image frontend/Dockerfile
# uses (node:24-alpine resolved to this digest on 2026-09-24). A floating tag
# changes the toolchain under an unchanged commit. How to move it:
# docs/DEVOPS/02-CONTAINERIZATION.md § Moving a pinned base image.
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS builder

WORKDIR /app

# The workspace manifests, and the lockfile that pins them. frontend/package.json
# is needed only so the lockfile's workspace entries match — `npm ci` refuses a
# lockfile that disagrees with the manifests. Its dependencies are not installed.
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

# Puppeteer ships its own Chromium download; skip it — the runtime image uses a
# system Chromium via PUPPETEER_EXECUTABLE_PATH, and the packager can't embed a
# browser binary anyway.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Install exactly the committed tree, backend workspace only. Dependencies are
# HOISTED to /app/node_modules, which is also how every test run and the lint
# gate see them.
RUN npm ci --workspace backend --no-audit --no-fund

# Copy source code
COPY backend/ backend/

WORKDIR /app/backend

# Generate Swagger JSON
RUN npm run swagger:generate

# Build standalone Linux binary. @yao-pkg/pkg is a backend devDependency, so
# npx runs the locked version rather than fetching one.
RUN npx --no-install pkg . \
    --targets node24-linux-x64 \
    --output /out/backend

# ==========================================
# STAGE 2 — RUNTIME
# ==========================================

# P7-07: pinned by digest (bookworm-slim on 2026-09-24). Debian point releases
# and security updates arrive by MOVING this digest deliberately, not by a
# rebuild picking up whatever the tag points at that day.
FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251

WORKDIR /app

# Runtime dependencies. chromium + fonts are needed for the certificate-PDF
# service (puppeteer), located at runtime via PUPPETEER_EXECUTABLE_PATH.
#
# Plain HTTP (port 80) to the Debian mirrors is blocked in the deployment
# subnet, so point apt at HTTPS. bookworm-slim ships no CA bundle, so apt could
# not verify the mirror. The previous fix disabled peer verification to fetch
# ca-certificates — which let anything on the build network serve the trust
# store everything afterwards verifies against (S-13).
#
# Instead, seed the bundle from the builder stage (node:24-alpine ships
# /etc/ssl/certs/ca-certificates.crt, and that image arrived over the
# registry's own verified TLS). apt's HTTPS transport reads exactly that path by
# default, so EVERY apt request below is verified. Installing Debian's
# ca-certificates package then regenerates the bundle from Debian's own set.
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN set -eux; \
    sed -i 's|http://|https://|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    sed -i 's|http://|https://|g' /etc/apt/sources.list 2>/dev/null || true; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        openssl \
        chromium \
        fonts-liberation \
        wget; \
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
RUN mkdir -p /app/backup/tenant-backups /app/log /app/uploads/profile /app/uploads/tenant \
        /app/storage /app/.well-known && \
    chown -R app:app /app/backup /app/log /app/uploads /app/storage /app/.well-known

# Copy binary
COPY --from=builder /out/backend ./backend

# Runtime assets read via appPath() (execPath-relative → /app). These are read
# from disk next to the binary, not from the embedded snapshot, so they must be
# shipped: the API spec, the email/certificate HTML templates, and the docs
# pages served at /documentation, /standards, /tab-permissions.
COPY --from=builder /app/backend/swagger.json ./swagger.json
COPY --from=builder /app/backend/src/templates ./src/templates
COPY --from=builder /app/backend/docs ./docs
# index.js mounts express.static(appPath("public")) at /public, and this COPY
# was missing — so every request under /public answered 404 in every container
# while working fine from a source checkout.
COPY --from=builder /app/backend/public ./public

# Environment
ENV NODE_ENV=production
ENV APP_STORAGE_PATH=/app
# System Chromium for puppeteer (certificate PDFs).
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Binary permissions
RUN chmod +x ./backend && \
    chown app:app ./backend

# Expose port
EXPOSE 3000

# Run as non-root
USER app

# Start application
CMD ["./backend"]