#!/usr/bin/env bash
# The rsync image import, LIVE: the backend IMAGE (rsync, openssh-client, sshpass), PostgreSQL 18,
# Redis, RabbitMQ and Mailpit, plus a throwaway SSH server holding SYNTHETIC photos — never a
# real server. Every container and the network are uniquely named and removed BY NAME on exit;
# nothing is pruned.
#
#   scripts/upstream/rsync-live-check.sh            # uses callibrator-be:rsync-import-live-2026-10-07
#   BACKEND_IMAGE=<tag> scripts/upstream/rsync-live-check.sh
#
# What it proves (scripts/upstream/rsync-app-path-check.ts prints each check):
#   check-connection: host keys → the fingerprint read on the server out of band → login with the
#   pinned key (password and key auth) → per-class estimate; the refusals (gate, allow-list,
#   injection, wrong key, wrong password, missing folder); an import that completes with the
#   expected counts and erases its credential; the in-app and e-mail notifications; a second
#   import that skips what is present; a bandwidth-limited import cancelled mid-transfer.
# And here, from outside the API: no process's argv holds the password during the transfer; the
# stored photos carry no GPS (re-inspected); the refused files sit in the quarantine; no PDF was
# copied; no secret in the audit rows or the backend's log; the ciphertext column is NULL after.
#
# Needs: docker, Node (the repo's .nvmrc), npm install done, ssh-keygen, openssl.
set -euo pipefail
export MSYS_NO_PATHCONV=1

root="$(cd "$(dirname "$0")/../.." && (pwd -W 2>/dev/null || pwd))"
image="${BACKEND_IMAGE:-callibrator-be:rsync-import-live-2026-10-07}"
tag="rsynclive-$$"
net="$tag-net"
api_port="${API_PORT:-5913}"
mail_port="${MAILPIT_PORT:-5914}"
work="$(mktemp -d)"
work="$(cygpath -m "$work" 2>/dev/null || echo "$work")"
containers=()

cleanup() {
  for c in "${containers[@]}"; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  docker network rm "$net" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

h() { openssl rand -hex "$1"; }
ssh_pw="pw-$(h 10)"

docker network create "$net" >/dev/null

# ---- the synthetic upstream tree and the importer's key ---------------------------------------
expected="$(cd "$root/backend" && node --import tsx "$root/scripts/upstream/rsync-live-fixtures.ts" "$work/upstream/public")"
ssh-keygen -t ed25519 -N "" -C "rsync-live" -f "$work/id_importer" -q

# ---- the SSH server (alpine + openssh + rsync), synthetic data under /srv/upstream ------------
docker create --name "$tag-ssh" --network "$net" --network-alias test-ssh -e SSH_PW="$ssh_pw" \
  alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc \
  sh -c 'apk add --no-cache openssh rsync >/dev/null && ssh-keygen -A >/dev/null \
    && adduser -D -s /bin/sh importer && echo "importer:$SSH_PW" | chpasswd >/dev/null \
    && mkdir -p /home/importer/.ssh && cp /tmp/importer.pub /home/importer/.ssh/authorized_keys \
    && chown -R importer /home/importer/.ssh && chmod 700 /home/importer/.ssh && chmod 600 /home/importer/.ssh/authorized_keys \
    && chmod -R a+rX /srv/upstream \
    && exec /usr/sbin/sshd -D -e -o PasswordAuthentication=yes' >/dev/null
containers+=("$tag-ssh")
docker cp "$work/id_importer.pub" "$tag-ssh:/tmp/importer.pub"
docker cp "$work/upstream" "$tag-ssh:/srv/"
docker start "$tag-ssh" >/dev/null

# ---- the datastores ---------------------------------------------------------------------------
db_pass="$(h 16)"; mq_pass="$(h 16)"
docker run -d --name "$tag-pg" --network "$net" --network-alias postgres -e POSTGRES_USER=callibrator \
  -e POSTGRES_PASSWORD="$db_pass" -e POSTGRES_DB=callibrator pgvector/pgvector:pg18 >/dev/null
containers+=("$tag-pg")
docker run -d --name "$tag-redis" --network "$net" --network-alias redis \
  redis:8.6-alpine@sha256:bb2e2e3ac0c7295b6f3b1b7ee5438f7320c74483cba1cb195f3fd43dad38de67 >/dev/null
containers+=("$tag-redis")
docker run -d --name "$tag-mq" --network "$net" --network-alias rabbitmq -e RABBITMQ_DEFAULT_USER=callibrator \
  -e RABBITMQ_DEFAULT_PASS="$mq_pass" \
  rabbitmq:3.13-management-alpine@sha256:606d8c0d6b3c18d1da9afc53bc7cdb2a8d5486df91b5a9830e9e07626c9ae281 >/dev/null
containers+=("$tag-mq")
docker run -d --name "$tag-mail" --network "$net" --network-alias mailpit -p "127.0.0.1:$mail_port:8025" \
  -e MP_SMTP_AUTH_ACCEPT_ANY=1 -e MP_SMTP_AUTH_ALLOW_INSECURE=1 \
  axllent/mailpit:v1.27@sha256:e22dce5b36f93c77082e204a3942fb6b283b7896e057458400a4c88344c3df68 >/dev/null
containers+=("$tag-mail")
until docker exec "$tag-pg" pg_isready -U callibrator >/dev/null 2>&1; do sleep 1; done
until docker exec "$tag-mq" rabbitmq-diagnostics -q ping >/dev/null 2>&1; do sleep 2; done

# ---- the backend image ------------------------------------------------------------------------
"$root/scripts/ci/e2e-env.sh" "$work/backend.env" "http://localhost:3000" >/dev/null
# This stack's own passwords replace the generated ones (one definition per variable).
sed -i -e "/^DB_PASS=/d" -e "/^RABBITMQ_PASS=/d" -e "/^REDIS_PASSWORD=/d" "$work/backend.env"
cat >> "$work/backend.env" <<ENV
DB_PASS=$db_pass
RABBITMQ_PASS=$mq_pass
RABBITMQ_URL=amqp://callibrator:$mq_pass@rabbitmq:5672
REDIS_PASSWORD=
UPSTREAM_REAL_DATA_ALLOWED=false
RSYNC_ALLOWED_HOSTS=test-ssh
VIRUS_SCAN_PROVIDER=none
ENV
docker run -d --name "$tag-be" --network "$net" -p "127.0.0.1:$api_port:3000" --env-file "$work/backend.env" "$image" >/dev/null
containers+=("$tag-be")
for _ in $(seq 1 120); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$api_port/health" || true)"
  [ "$code" = "200" ] && break
  sleep 2
done
[ "$code" = "200" ] || { docker logs --tail 80 "$tag-be"; exit 1; }
curl -sf "http://127.0.0.1:$api_port/api/v1/migration/seeding" >/dev/null
docker exec "$tag-be" cat /app/.bootstrap/superadmin-password > "$work/bootstrap"

# The tools are in the image.
docker exec "$tag-be" sh -c 'command -v rsync && command -v ssh && command -v ssh-keyscan && command -v sshpass' >/dev/null \
  && echo "ok    the image ships rsync, ssh, ssh-keyscan and sshpass"

# The fingerprint an operator reads ON THE SERVER, out of band, to compare with the page's.
fp="$(docker exec "$tag-ssh" ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub | awk '{print $2}')"

# ---- the API path (in the background, so argv can be read during import 3) --------------------
state="$work/state.json"
(cd "$root/backend" && API="http://127.0.0.1:$api_port/api/v1" ADMIN_EMAIL=sys@mail.com \
  BOOTSTRAP_PASSWORD_FILE="$work/bootstrap" ADMIN_NEW_PASSWORD="Rsync-$(h 8)-Aa1!" MFA_STATE_FILE="$work/mfa" \
  MAILPIT="http://127.0.0.1:$mail_port" SSH_HOST=test-ssh SSH_PORT=22 SSH_USER=importer SSH_PASSWORD="$ssh_pw" \
  SSH_KEY_FILE="$work/id_importer" HOST_FINGERPRINT="$fp" EXPECTED="$expected" STATE_FILE="$state" ARGV_WINDOW_MS=8000 \
  node --import tsx "$root/scripts/upstream/rsync-app-path-check.ts") &
check_pid=$!

# While import 3 transfers: every process's argv in the backend container, read from /proc.
for _ in $(seq 1 240); do
  if [ -f "$state" ] && grep -q '"phase":"transferring"' "$state"; then break; fi
  kill -0 "$check_pid" 2>/dev/null || break
  sleep 0.5
done
if [ -f "$state" ] && grep -q '"phase":"transferring"' "$state"; then
  sleep 2
  argv="$(docker exec "$tag-be" sh -c 'for f in /proc/[0-9]*/cmdline; do tr "\0" " " < "$f" 2>/dev/null; echo; done')"
  echo "$argv" | grep -q "rsync" || { echo "FAIL  no rsync process during the transfer"; exit 1; }
  echo "$argv" | grep -q -- "--protect-args" && echo "ok    rsync runs with --protect-args during the transfer"
  if echo "$argv" | grep -qF -- "$ssh_pw"; then echo "FAIL  the SSH password is in a process's argv"; exit 1; fi
  echo "ok    no process's argv holds the SSH password (sshpass reads SSHPASS)"
fi
wait "$check_pid"

first_id="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$state','utf8')).firstId)")"

# ---- from outside the API ----------------------------------------------------------------------
psql() { docker exec "$tag-pg" psql -U callibrator -d callibrator -tAc "$1"; }
[ "$(psql "SELECT count(*) FROM upstream_file_imports WHERE secret_ciphertext IS NOT NULL")" = "0" ] \
  && echo "ok    no credential left in upstream_file_imports (every import ended)"
psql "SELECT changes::text FROM audit_logs WHERE resource_type = 'UpstreamFileImport'" > "$work/audit.txt"
[ -s "$work/audit.txt" ] && ! grep -qF -- "$ssh_pw" "$work/audit.txt" && ! grep -q "OPENSSH PRIVATE KEY" "$work/audit.txt" \
  && echo "ok    $(wc -l < "$work/audit.txt" | tr -d ' ') audit rows, none with the credential"
docker logs "$tag-be" > "$work/backend.log" 2>&1
! grep -qF -- "$ssh_pw" "$work/backend.log" && ! grep -q "OPENSSH PRIVATE KEY" "$work/backend.log" \
  && echo "ok    the backend's log holds no credential"

base=/app/storage/.upstream-import
docker exec "$tag-be" sh -c "test -f $base/refused/$first_id/file_type_refused/foto_depan/upload.sh" \
  && echo "ok    the shell script is in the quarantine (refused/file_type_refused), never ingested"
[ "$(docker exec "$tag-be" sh -c "find $base /app/storage/t -name '*.pdf' | wc -l")" = "0" ] \
  && echo "ok    no certificate PDF was copied or stored"
[ "$(docker exec "$tag-be" sh -c "find $base/runs -type f | wc -l")" = "0" ] \
  && echo "ok    no run scratch (key file, known_hosts) left behind"

# The stored photos, re-inspected: no GPS left, the manifest's stored hash is the object's.
mkdir -p "$work/stored"
docker cp "$tag-be:/app/storage/t/." "$work/stored/"
docker cp "$tag-be:$base/manifests/$first_id.jsonl" "$work/manifest.jsonl"
(cd "$root/backend" && node --import tsx -e "
  const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
  const { inspectJpeg, inspectPng } = require('./src/services/upstreamFileImport/imageInspect.ts');
  const lines = fs.readFileSync('$work/manifest.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const ingested = lines.filter((l) => l.outcome === 'ingested');
  for (const l of ingested) {
    const file = path.join('$work/stored', ...l.storageKey.split('/').slice(1));
    const bytes = fs.readFileSync(file);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== l.storedSha256) { console.error('FAIL  hash', l.storageKey); process.exit(1); }
    const again = l.detectedType === 'png' ? inspectPng(bytes) : inspectJpeg(bytes);
    if (!again.ok || again.stripped) { console.error('FAIL  metadata left in', l.storageKey); process.exit(1); }
    if (/foto|d-0|s-0/.test(l.storageKey)) { console.error('FAIL  a source name in a key'); process.exit(1); }
  }
  console.log('ok    ' + ingested.length + ' stored photos: SHA-256 = manifest, no location metadata left, UUID keys');
")

echo "rsync live check: PASSED"
