#!/usr/bin/env bash
# P8-01 (ADR-086 Amendment 1) — every file the application stores or serves,
# through a RUNNING backend whose storage is a real S3-compatible server, with
# two tenants.
#
#   scripts/storage/p801-live-check.sh
#
# Starts, in containers named p801-<pid>-*: SeaweedFS (S3 API, SigV4
# credentials enforced), PostgreSQL 18 (pgvector) and Redis. Boots the backend
# from this checkout under tsx with STORAGE_DRIVER=s3 and SEED_DEMO=true, then
# runs scripts/storage/p801-app-path-check.ts. Every container is removed BY
# NAME on exit; nothing is pruned. Refuses to start when a one-time password
# file already exists (the seed would overwrite it), and removes only the one
# its own seed wrote.
#
# Written for Git Bash on Windows (pwd -W, cygpath -m, MSYS_NO_PATHCONV=1),
# with the POSIX forms as fallbacks. Needs docker, Node (the repo's .nvmrc),
# npm install done, and backend/.env (for the secrets the backend boots with).
set -euo pipefail
export MSYS_NO_PATHCONV=1

root="$(cd "$(dirname "$0")/../.." && (pwd -W 2>/dev/null || pwd))"
tag="p801-$$"
access="p801access"
secret="p801-$(openssl rand -hex 12)"
seaweed_port="${SEAWEED_PORT:-18433}"
pg_port="${PG_PORT:-55801}"; redis_port="${REDIS_PORT_P801:-56801}"; api_port="${API_PORT:-5801}"
work="$(mktemp -d)"
work="$(cygpath -m "$work" 2>/dev/null || echo "$work")"
containers=()

bootstrap="$root/backend/.bootstrap/superadmin-password"
if [ -e "$bootstrap" ]; then
  echo "refusing: $bootstrap exists (a seed would overwrite it) — move it first" >&2; exit 1
fi

cleanup() {
  [ -n "${backend_pid:-}" ] && kill "$backend_pid" 2>/dev/null || true
  [ -n "${own_bootstrap:-}" ] && rm -f "$own_bootstrap"
  for c in "${containers[@]}"; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  [ "${KEEP_LOG:-0}" = "1" ] && cp "$work/backend.log" "$root/p801-backend.log" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

printf '{"identities":[{"name":"p801","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin","Read","Write","List","Tagging"]}]}' \
  "$access" "$secret" > "$work/s3.json"
docker run -d --name "$tag-seaweed" -p "$seaweed_port:8333" -v "$work/s3.json:/etc/s3.json:ro" \
  chrislusf/seaweedfs:latest server -s3 -s3.config=/etc/s3.json -dir=/data >/dev/null
containers+=("$tag-seaweed")
pg_pass="$(openssl rand -hex 12)"
docker run -d --name "$tag-pg18" -p "$pg_port:5432" -e POSTGRES_USER=p801 -e POSTGRES_PASSWORD="$pg_pass" \
  -e POSTGRES_DB=callibrator_scratch_p801 pgvector/pgvector:pg18 >/dev/null
containers+=("$tag-pg18")
docker run -d --name "$tag-redis" -p "$redis_port:6379" redis:7-alpine >/dev/null
containers+=("$tag-redis")

wait_http() {
  for _ in $(seq 1 90); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$1" || true)"
    [ "$code" != "000" ] && return 0
    sleep 1
  done
  echo "no answer from $1" >&2; return 1
}
wait_http "http://127.0.0.1:$seaweed_port/"
until docker exec "$tag-pg18" pg_isready -U p801 >/dev/null 2>&1; do sleep 1; done

own_bootstrap="$bootstrap"
export PORT="$api_port" DB_HOST=127.0.0.1 DB_PORT="$pg_port" DB_NAME=callibrator_scratch_p801 DB_USER=p801 DB_PASS="$pg_pass"
export REDIS_URL="redis://127.0.0.1:$redis_port" REDIS_HOST=127.0.0.1 REDIS_PORT="$redis_port"
export RABBITMQ_URL=amqp://127.0.0.1:1 RABBITMQ_PORT=1 VIRUS_SCAN_PROVIDER=none NODE_ENV=development ALLOW_SEEDING=true SEED_DEMO=true
export STORAGE_DRIVER=s3 STORAGE_S3_BUCKET=p801-platform STORAGE_S3_ENDPOINT="http://127.0.0.1:$seaweed_port" \
  STORAGE_S3_ACCESS_KEY_ID="$access" STORAGE_S3_SECRET_ACCESS_KEY="$secret" STORAGE_S3_REGION=us-east-1
# The bucket exists before the backend's first request needs it.
(cd "$root/backend" && node -e '
const { S3Client, CreateBucketCommand } = require("@aws-sdk/client-s3");
new S3Client({ region: "us-east-1", endpoint: process.env.STORAGE_S3_ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID, secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY } })
  .send(new CreateBucketCommand({ Bucket: process.env.STORAGE_S3_BUCKET })).then(() => 0, (e) => { console.error(e.name); });')
(cd "$root/backend" && exec node --import tsx index.ts > "$work/backend.log" 2>&1) &
backend_pid=$!
wait_http "http://127.0.0.1:$api_port/api/v1/migration/seeding" || { tail -40 "$work/backend.log"; exit 1; }
# The first answer can come while the boot is still finishing: retry the seed.
for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:$api_port/api/v1/migration/seeding" >/dev/null && break
  sleep 2
done

API="http://127.0.0.1:$api_port/api/v1" ADMIN_EMAIL=sys@mail.com BOOTSTRAP_PASSWORD_FILE="$bootstrap" \
  ADMIN_NEW_PASSWORD="P801-$(openssl rand -hex 8)-Aa1!" MFA_STATE_FILE="$work/mfa-secret" \
  S3_ADMIN_ENDPOINT="http://127.0.0.1:$seaweed_port" S3_ACCESS_KEY="$access" S3_SECRET_KEY="$secret" \
  PLATFORM_BUCKET=p801-platform BACKEND_DIR="$root/backend" \
  PSQL="docker exec -i $tag-pg18 psql -U p801 -d callibrator_scratch_p801 -At" \
  node --import tsx "$root/scripts/storage/p801-app-path-check.ts"
