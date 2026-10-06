#!/usr/bin/env bash
# U-09 — the object-storage S3 driver against REAL S3-compatible servers.
#
#   scripts/storage/s3-live-check.sh            # driver suite on SeaweedFS and Versity S3 Gateway
#   APP_PATH=1 scripts/storage/s3-live-check.sh # + the request path through a running backend
#
# 1. Starts SeaweedFS (S3 API) and Versity S3 Gateway (posix backend) in
#    uniquely named containers, each with SigV4 credentials. MinIO is not used:
#    its images can no longer be pulled anonymously (Docker Hub "pull access
#    denied", Quay 401 — MEMORY/records/2026-10-05-u09-s3-live.md).
# 2. Runs backend/src/tests/services/storage.s3.u09.live.test.ts against each.
# 3. With APP_PATH=1: a throwaway PostgreSQL 18 (pgvector) and Redis, the
#    backend under tsx with STORAGE_DRIVER=s3 on SeaweedFS and
#    SSRF_DEV_ALLOW_HOSTS=host.docker.internal, then
#    scripts/storage/s3-app-path-check.ts (settings, usage, signed objects,
#    the migration CLI).
# Every container is removed BY NAME on exit; nothing is pruned.
#
# Needs: docker, Node (the repo's .nvmrc), npm install done, backend/.env
# (for the secrets the backend boots with). On Docker Desktop
# host.docker.internal resolves to a private address of this machine, which is
# what the SSRF allow-list case needs; elsewhere set S3_LIVE_DEV_HOST to a host
# name that does (or leave it empty to skip that case).
set -euo pipefail
export MSYS_NO_PATHCONV=1

# pwd -W: the Windows form under Git Bash (node and docker take it; MSYS path conversion is off).
root="$(cd "$(dirname "$0")/../.." && (pwd -W 2>/dev/null || pwd))"
tag="u09-$$"
access="u09access"
secret="u09-$(openssl rand -hex 12)"
seaweed_port="${SEAWEED_PORT:-18333}"
vgw_port="${VGW_PORT:-17070}"
dev_host="${S3_LIVE_DEV_HOST-host.docker.internal}"
work="$(mktemp -d)"
work="$(cygpath -m "$work" 2>/dev/null || echo "$work")" # node and docker need the Windows form under Git Bash
containers=()

cleanup() {
  [ -n "${backend_pid:-}" ] && kill "$backend_pid" 2>/dev/null || true
  # The one-time password file this run's seed wrote (never one it found).
  [ -n "${own_bootstrap:-}" ] && rm -f "$own_bootstrap"
  for c in "${containers[@]}"; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  rm -rf "$work"
}
trap cleanup EXIT

printf '{"identities":[{"name":"u09","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin","Read","Write","List","Tagging"]}]}' \
  "$access" "$secret" > "$work/s3.json"

docker run -d --name "$tag-seaweed" -p "$seaweed_port:8333" -v "$work/s3.json:/etc/s3.json:ro" \
  chrislusf/seaweedfs:latest server -s3 -s3.config=/etc/s3.json -dir=/data >/dev/null
containers+=("$tag-seaweed")
docker run -d --name "$tag-vgw" -p "$vgw_port:7070" -e ROOT_ACCESS_KEY_ID="$access" -e ROOT_SECRET_ACCESS_KEY="$secret" \
  --entrypoint versitygw versity/versitygw:latest posix /tmp >/dev/null
containers+=("$tag-vgw")

wait_http() { # url — any HTTP answer (S3 answers 403 to an anonymous GET)
  for _ in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$1" || true)"
    [ "$code" != "000" ] && return 0
    sleep 1
  done
  echo "no answer from $1" >&2; return 1
}
wait_http "http://127.0.0.1:$seaweed_port/"
wait_http "http://127.0.0.1:$vgw_port/"

for server in "seaweedfs http://127.0.0.1:$seaweed_port" "versitygw http://127.0.0.1:$vgw_port"; do
  set -- $server
  echo "== driver suite on $1 ($2)"
  (cd "$root/backend" && S3_LIVE_ENDPOINT="$2" S3_LIVE_ACCESS_KEY="$access" S3_LIVE_SECRET_KEY="$secret" \
    S3_LIVE_DEV_HOST="$dev_host" npm test -- src/tests/services/storage.s3.u09.live --coverage=false)
done

[ "${APP_PATH:-0}" = "1" ] || exit 0

bootstrap="$root/backend/.bootstrap/superadmin-password"
if [ -e "$bootstrap" ]; then
  echo "refusing: $bootstrap exists (a seed would overwrite it) — move it first" >&2; exit 1
fi
own_bootstrap="$bootstrap"
pg_port="${PG_PORT:-55909}"; redis_port="${REDIS_PORT_U09:-56909}"; api_port="${API_PORT:-5909}"
pg_pass="$(openssl rand -hex 12)"
docker run -d --name "$tag-pg18" -p "$pg_port:5432" -e POSTGRES_USER=u09 -e POSTGRES_PASSWORD="$pg_pass" \
  -e POSTGRES_DB=callibrator_scratch_u09 pgvector/pgvector:pg18 >/dev/null
containers+=("$tag-pg18")
docker run -d --name "$tag-redis" -p "$redis_port:6379" redis:7-alpine >/dev/null
containers+=("$tag-redis")
until docker exec "$tag-pg18" pg_isready -U u09 >/dev/null 2>&1; do sleep 1; done

export PORT="$api_port" DB_HOST=127.0.0.1 DB_PORT="$pg_port" DB_NAME=callibrator_scratch_u09 DB_USER=u09 DB_PASS="$pg_pass"
export REDIS_URL="redis://127.0.0.1:$redis_port" REDIS_HOST=127.0.0.1 REDIS_PORT="$redis_port"
export RABBITMQ_URL=amqp://127.0.0.1:1 RABBITMQ_PORT=1 VIRUS_SCAN_PROVIDER=none NODE_ENV=development ALLOW_SEEDING=true
export STORAGE_DRIVER=s3 STORAGE_S3_BUCKET=u09-platform STORAGE_S3_ENDPOINT="http://127.0.0.1:$seaweed_port" \
  STORAGE_S3_ACCESS_KEY_ID="$access" STORAGE_S3_SECRET_ACCESS_KEY="$secret" STORAGE_S3_REGION=us-east-1
export SSRF_DEV_ALLOW_HOSTS="$dev_host"
(cd "$root/backend" && exec node --import tsx index.ts > "$work/backend.log" 2>&1) &
backend_pid=$!
wait_http "http://127.0.0.1:$api_port/api/v1/migration/seeding" || { tail -40 "$work/backend.log"; exit 1; }
curl -sf "http://127.0.0.1:$api_port/api/v1/migration/seeding" >/dev/null

SIGN_SECRET="$(cd "$root/backend" && node -e "const e=require('dotenv').parse(require('fs').readFileSync('.env'));process.stdout.write(e.ATTACHMENT_URL_SECRET||e.CERT_SIGNING_SECRET||'')")"
API="http://127.0.0.1:$api_port/api/v1" ADMIN_EMAIL=sys@mail.com BOOTSTRAP_PASSWORD_FILE="$bootstrap" \
  ADMIN_NEW_PASSWORD="U09-$(openssl rand -hex 8)-Aa1!" MFA_STATE_FILE="$work/mfa-secret" \
  S3_ADMIN_ENDPOINT="http://127.0.0.1:$seaweed_port" S3_TENANT_ENDPOINT="http://$dev_host:$seaweed_port" \
  S3_ACCESS_KEY="$access" S3_SECRET_KEY="$secret" PLATFORM_BUCKET=u09-platform SIGN_SECRET="$SIGN_SECRET" \
  BACKEND_DIR="$root/backend" node --import tsx "$root/scripts/storage/s3-app-path-check.ts"
