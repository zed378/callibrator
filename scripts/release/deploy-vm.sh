#!/usr/bin/env bash
# Deploy on the reference VM: pull the images last pushed by scripts/release/push-images.ps1 and
# recreate what changed (ADR-123 Am. 1). Build and push FIRST, then run this on the VM:
#
#   cd /home/infra/callibrator && git fetch -q origin && git reset -q --hard origin/main
#   bash scripts/release/deploy-vm.sh
#
# IMAGE_TAG in deploy/compose/.env selects the tag (default `latest`); *_DIGEST must be unset for a
# moving tag. `--pull always` matters: a plain `up -d` keeps a local image of the same tag.
set -euo pipefail
cd "$(dirname "$0")/../../deploy/compose"
DC="docker compose -p callibrator -f docker-compose.yml -f docker-compose.vm.yml"

if grep -Eq '^(BACKEND|FRONTEND|BACKUP)_DIGEST=.+' .env; then
  echo "A *_DIGEST is set in .env: it pins an old image. Unset it to deploy the pushed tag." >&2
  exit 1
fi

$DC up -d --pull always --no-build

for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:19000/health >/dev/null 2>&1 && break
  sleep 5
done
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' callibrator-frontend-1)" = healthy ] && break
  sleep 3
done
# nginx resolves the frontend's address at start: a recreated frontend answers 502 until it restarts.
$DC restart nginx >/dev/null

$DC ps --format '{{.Service}} {{.Status}} {{.Image}}'
echo "seeding endpoint: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:19000/api/v1/migration/seeding) (expect 401)"
for p in / /login; do
  curl -s -o /dev/null -w "public $p: %{http_code}\n" "https://kalibrasi.zedth.my.id$p"
done
