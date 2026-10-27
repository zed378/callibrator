#!/usr/bin/env bash
# =============================================================================
# Callibrator - Build Docker Images and Push to Docker Hub (Shell Script)
# =============================================================================
# Usage:
#   ./deploy/build-push.sh [options]
#
# Options:
#   -t, --tag <tag>             Additional image tag (default: latest only)
#   -u, --user <username>       Docker Hub user/org (default: zed378)
#   -s, --service <service>     Service to build: 'all', 'backend', 'frontend', 'backup' (default: all)
#   --public-url <url>          Frontend public URL (default: https://kalibrasi.zedth.my.id)
#   --api-base-url <url>        NEXT_PUBLIC_API_BASE_URL (default: $PUBLIC_URL)
#   --site-url <url>            NEXT_PUBLIC_SITE_URL (default: $PUBLIC_URL)
#   --api-version <ver>         NEXT_PUBLIC_API_VERSION (default: v1)
#   --tenant-id <id>            NEXT_PUBLIC_TENANT_ID (default: empty)
#   --contact-whatsapp <num>    NEXT_PUBLIC_CONTACT_WHATSAPP
#   --contact-email <email>     NEXT_PUBLIC_CONTACT_EMAIL
#   --no-push                   Build only, do not push
#   -h, --help                  Show this help message
# =============================================================================

set -euo pipefail

# Colors
C_CYAN='\033[0;36m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[1;33m'
C_RED='\033[0;31m'
C_RESET='\033[0m'

info() { echo -e "\n${C_CYAN}==> $1${C_RESET}"; }
success() { echo -e "${C_GREEN}[OK] $1${C_RESET}"; }
warn() { echo -e "${C_YELLOW}[WARN] $1${C_RESET}"; }
err() { echo -e "${C_RED}[ERROR] $1${C_RESET}" >&2; }

# Defaults
HUB_USER="zed378"
TAG="latest"
SERVICE="all"
PUBLIC_URL="https://kalibrasi.zedth.my.id"
API_BASE_URL=""
SITE_URL=""
API_VERSION="v1"
TENANT_ID=""
CONTACT_WHATSAPP=""
CONTACT_EMAIL=""
NO_PUSH=false

show_help() {
    cat <<EOF
Callibrator - Docker Build & Push Script

Usage: $(basename "$0") [options]

Options:
  -t, --tag <tag>           Additional image tag (default: latest only)
  -u, --user <username>     Docker Hub username/org (default: zed378)
  -s, --service <service>   Service to build: all, backend, frontend, backup (default: all)
  --public-url <url>        Frontend Public URL (default: https://kalibrasi.zedth.my.id)
  --no-push                 Build only; do not push images
  -h, --help                Show this help message
EOF
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -t|--tag)
            TAG="$2"; shift 2 ;;
        -u|--user)
            HUB_USER="$2"; shift 2 ;;
        -s|--service)
            SERVICE="$2"; shift 2 ;;
        --public-url)
            PUBLIC_URL="$2"; shift 2 ;;
        --api-base-url)
            API_BASE_URL="$2"; shift 2 ;;
        --site-url)
            SITE_URL="$2"; shift 2 ;;
        --api-version)
            API_VERSION="$2"; shift 2 ;;
        --tenant-id)
            TENANT_ID="$2"; shift 2 ;;
        --contact-whatsapp)
            CONTACT_WHATSAPP="$2"; shift 2 ;;
        --contact-email)
            CONTACT_EMAIL="$2"; shift 2 ;;
        --no-push)
            NO_PUSH=true; shift ;;
        -h|--help)
            show_help ;;
        *)
            if [[ "$TAG" == "latest" ]]; then
                TAG="$1"
                shift
            else
                err "Unknown option: $1"
                exit 1
            fi
            ;;
    esac
done

# 1. Resolve repository root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"
info "Working directory: ${REPO_ROOT}"

# 2. Check docker
if ! command -v docker &>/dev/null; then
    err "Docker is not found on PATH. Please install or start Docker."
    exit 1
fi

# 3. Determine tag (always latest as primary)
if [[ -z "${TAG}" ]]; then
    TAG="latest"
fi

if [[ -z "${API_BASE_URL}" ]]; then API_BASE_URL="${PUBLIC_URL}"; fi
if [[ -z "${SITE_URL}" ]]; then SITE_URL="${PUBLIC_URL}"; fi

BACKEND_REPO="${HUB_USER}/calibration-be"
FRONTEND_REPO="${HUB_USER}/calibration-fe"
BACKUP_REPO="${HUB_USER}/calibration-backup"

info "Configuration:"
echo "  Hub User:       ${HUB_USER}"
echo "  Primary Tag:    latest"
if [[ "${TAG}" != "latest" ]]; then
    echo "  Additional Tag: ${TAG}"
fi
echo "  Service:        ${SERVICE}"
echo "  Push to Hub:    $([ "$NO_PUSH" = false ] && echo "Yes" || echo "No")"
echo "  Public URL:     ${PUBLIC_URL}"

# 4. Build Images
# 4a. Backend
if [[ "${SERVICE}" == "all" || "${SERVICE}" == "backend" ]]; then
    info "Building Backend Image (${BACKEND_REPO}:latest)..."
    BUILD_CMD=(docker build -f backend/Dockerfile -t "${BACKEND_REPO}:latest")
    if [[ "${TAG}" != "latest" ]]; then
        BUILD_CMD+=(-t "${BACKEND_REPO}:${TAG}")
    fi
    BUILD_CMD+=(.)
    "${BUILD_CMD[@]}"
    success "Backend built successfully."
fi

# 4b. Frontend
if [[ "${SERVICE}" == "all" || "${SERVICE}" == "frontend" ]]; then
    info "Building Frontend Image (${FRONTEND_REPO}:latest)..."
    BUILD_CMD=(docker build -f frontend/Dockerfile -t "${FRONTEND_REPO}:latest")
    if [[ "${TAG}" != "latest" ]]; then
        BUILD_CMD+=(-t "${FRONTEND_REPO}:${TAG}")
    fi
    BUILD_CMD+=(
        --build-arg "NEXT_PUBLIC_API_BASE_URL=${API_BASE_URL}"
        --build-arg "NEXT_PUBLIC_SITE_URL=${SITE_URL}"
        --build-arg "NEXT_PUBLIC_API_VERSION=${API_VERSION}"
        --build-arg "NEXT_PUBLIC_TENANT_ID=${TENANT_ID}"
        --build-arg "NEXT_PUBLIC_CONTACT_WHATSAPP=${CONTACT_WHATSAPP}"
        --build-arg "NEXT_PUBLIC_CONTACT_EMAIL=${CONTACT_EMAIL}"
        .
    )
    "${BUILD_CMD[@]}"
    success "Frontend built successfully."
fi

# 4c. Backup Verifier
if [[ "${SERVICE}" == "all" || "${SERVICE}" == "backup" ]]; then
    info "Building Backup Verifier Image (${BACKUP_REPO}:latest)..."
    BUILD_CMD=(docker build -f deploy/backup/Dockerfile -t "${BACKUP_REPO}:latest")
    if [[ "${TAG}" != "latest" ]]; then
        BUILD_CMD+=(-t "${BACKUP_REPO}:${TAG}")
    fi
    BUILD_CMD+=(
        --build-context "backend-image=docker-image://${BACKEND_REPO}:latest"
        .
    )
    "${BUILD_CMD[@]}"
    success "Backup verifier built successfully."
fi

# 5. Push Images
if [[ "${NO_PUSH}" == true ]]; then
    info "Skipping push (--no-push specified)."
    exit 0
fi

info "Pushing images to Docker Hub..."

push_image() {
    local repo="$1"
    info "Pushing ${repo}:latest..."
    docker push "${repo}:latest"
    if [[ "${TAG}" != "latest" ]]; then
        info "Pushing ${repo}:${TAG}..."
        docker push "${repo}:${TAG}"
    fi
}

if [[ "${SERVICE}" == "all" || "${SERVICE}" == "backend" ]]; then push_image "${BACKEND_REPO}"; fi
if [[ "${SERVICE}" == "all" || "${SERVICE}" == "frontend" ]]; then push_image "${FRONTEND_REPO}"; fi
if [[ "${SERVICE}" == "all" || "${SERVICE}" == "backup" ]]; then push_image "${BACKUP_REPO}"; fi

success "\nAll images successfully built and pushed to Docker Hub with tag :latest!"
