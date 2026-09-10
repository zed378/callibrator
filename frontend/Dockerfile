# =========================
# Stage 1: Build + Compile
# =========================
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy dependency files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build + compile
RUN bun run build:docker

# Verify binary
RUN ls -lah /app/server

# =========================
# Stage 2: Runtime
# =========================
FROM alpine:3.22 AS runner

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    libstdc++ \
    libc6-compat \
    wget

# Copy compiled server
COPY --from=builder /app/server ./server

# Make executable
RUN chmod +x ./server

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1

# Run compiled binary
CMD ["./server"]