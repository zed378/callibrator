# ==========================================
# STAGE 1 — BUILDER
# ==========================================

FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Puppeteer ships its own Chromium download; skip it — the runtime image uses a
# system Chromium via PUPPETEER_EXECUTABLE_PATH, and the packager can't embed a
# browser binary anyway.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Generate Swagger JSON
RUN npm run swagger:generate

# Build standalone Linux binary
RUN npx @yao-pkg/pkg . \
    --targets node24-linux-x64 \
    --output /app/backend

# ==========================================
# STAGE 2 — RUNTIME
# ==========================================

FROM debian:bookworm-slim

WORKDIR /app

# Runtime dependencies. chromium + fonts are needed for the certificate-PDF
# service (puppeteer), located at runtime via PUPPETEER_EXECUTABLE_PATH.
#
# Plain HTTP (port 80) to the Debian mirrors is blocked in the deployment
# subnet, so point apt at HTTPS. bookworm-slim ships no CA bundle yet, so
# bootstrap ca-certificates over HTTPS with peer verification disabled for that
# single step, then install everything else normally (verification back on).
RUN set -eux; \
    sed -i 's|http://|https://|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    sed -i 's|http://|https://|g' /etc/apt/sources.list 2>/dev/null || true; \
    apt-get -o Acquire::https::Verify-Peer=false update; \
    apt-get -o Acquire::https::Verify-Peer=false install -y --no-install-recommends ca-certificates; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        openssl \
        chromium \
        fonts-liberation; \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -r -s /usr/sbin/nologin app

# Create persistent storage directories
RUN mkdir -p /app/backup/tenant-backups /app/log /app/uploads/profile /app/uploads/tenant && \
    chown -R app:app /app/backup /app/log /app/uploads

# Copy binary
COPY --from=builder /app/backend ./backend

# Runtime assets read via appPath() (execPath-relative → /app). These are read
# from disk next to the binary, not from the embedded snapshot, so they must be
# shipped: the API spec, the email/certificate HTML templates, and the docs
# pages served at /documentation, /standards, /tab-permissions.
COPY --from=builder /app/swagger.json ./swagger.json
COPY --from=builder /app/src/templates ./src/templates
COPY --from=builder /app/docs ./docs

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