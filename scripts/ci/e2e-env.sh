#!/usr/bin/env bash
# The env file of a disposable E2E / browser stack (deploy/compose/docker-compose.e2e.yml).
# Every secret random (openssl, as `make secrets` does), mail to Mailpit, production defaults.
# Usage: scripts/ci/e2e-env.sh <out-file> <frontend-origin, e.g. http://localhost:27131>
# The file holds secrets: write it outside the repository (CI: $RUNNER_TEMP).
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: $0 <out-file> <frontend-origin>" >&2; exit 2; }
out="$1"; fe="$2"
h() { openssl rand -hex "$1"; }
cat > "$out" <<ENV
CERT_SIGNING_SECRET=$(h 32)
ENCRYPT_KEY=$(h 32)
ATTACHMENT_URL_SECRET=$(h 32)
KMS_MASTER_KEY=$(h 32)
JWT_ACCESS_SECRET=$(h 32)
JWT_REFRESH_SECRET=$(h 32)
ACCESS_REQUEST_IP_PEPPER=$(h 32)
DB_PASS=$(h 16)
RABBITMQ_PASS=$(h 16)
REDIS_PASSWORD=$(h 16)
DB_HOST=postgres
DB_PORT=5432
DB_NAME=callibrator
DB_USER=callibrator
DB_APP_ROLE=callibrator_app
DB_DIALECT=postgres
DB_SSL=false
REDIS_URL=redis://redis:6379
RABBITMQ_USER=callibrator
JWT_ACCESS_EXPIRED=15m
JWT_REFRESH_EXPIRED=7d
HOST_URL=$fe
FRONTEND_URL=$fe
CORS_ORIGIN=$fe
FORCE_HTTPS=false
TZ=Asia/Jakarta
CERT_VERIFY_BASE_URL=$fe/verify
MAIL_HOST=mailpit
MAIL_PORT=1025
MAIL_USER=e2e
MAIL_PASSWORD=$(h 8)
MAIL_FROM=noreply@e2e.test
STORAGE_DRIVER=local
VIRUS_SCAN_PROVIDER=none
ALLOW_SEEDING=true
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=$fe
ACCESS_REQUEST_NOTIFY_EMAIL=platform-inbox@e2e.test
PRIVACY_NOTICE_URL=${E2E_PRIVACY_NOTICE_URL:-https://example.com/privacy-notice}
BACKEND_INTERNAL_URL=http://backend:3000
ENV
chmod 600 "$out"
echo "wrote $out"
