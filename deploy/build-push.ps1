#Requires -Version 5.1
<#
.SYNOPSIS
    Build Callibrator Docker images and push them to Docker Hub.

.DESCRIPTION
    Builds backend, frontend, and backup-verify images, tags them with a given tag
    (default: git short commit SHA or 'latest') and optionally 'latest', then pushes to Docker Hub.
    Runs from anywhere; automatically resolves repository root.

.PARAMETER Tag
    Image tag. Defaults to git short commit SHA, or 'latest' if git is not available.
.PARAMETER HubUser
    Docker Hub username or organization. Default: zed378
.PARAMETER PublicUrl
    Public URL baked into the frontend image. Default: https://kalibrasi.zedth.my.id
.PARAMETER ApiBaseUrl
    NEXT_PUBLIC_API_BASE_URL. Default: $PublicUrl
.PARAMETER SiteUrl
    NEXT_PUBLIC_SITE_URL. Default: $PublicUrl
.PARAMETER ApiVersion
    NEXT_PUBLIC_API_VERSION. Default: v1
.PARAMETER TenantId
    NEXT_PUBLIC_TENANT_ID. Default: empty (multi-tenant)
.PARAMETER ContactWhatsapp
    NEXT_PUBLIC_CONTACT_WHATSAPP
.PARAMETER ContactEmail
    NEXT_PUBLIC_CONTACT_EMAIL
.PARAMETER Service
    Which service to build/push: 'all', 'backend', 'frontend', 'backup'. Default: 'all'
.PARAMETER NoPush
    Build only; do not push images to Docker Hub.
.PARAMETER NoLatest
    Do not tag or push 'latest' tag.

.EXAMPLE
    .\deploy\build-push.ps1
    # Builds all images and pushes to zed378/calibration-*:sha and :latest

.EXAMPLE
    .\deploy\build-push.ps1 -Tag v1.0.0 -HubUser myorg
    # Builds and pushes with tag v1.0.0 and :latest under myorg namespace

.EXAMPLE
    .\deploy\build-push.ps1 -NoPush
    # Builds images locally without pushing
#>
[CmdletBinding()]
param(
    [string]$Tag = 'latest',
    [string]$HubUser = 'zed378',
    [string]$PublicUrl = 'https://kalibrasi.zedth.my.id',
    [string]$ApiBaseUrl = '',
    [string]$SiteUrl = '',
    [string]$ApiVersion = 'v1',
    [string]$TenantId = '',
    [string]$ContactWhatsapp = '',
    [string]$ContactEmail = '',
    [ValidateSet('all', 'backend', 'frontend', 'backup')]
    [string]$Service = 'all',
    [switch]$NoPush
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Info([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Success([string]$msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err([string]$msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red }

# 1. Resolve repository root (parent directory of deploy/)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir '..')).Path
Set-Location $RepoRoot
Write-Info "Working directory: $RepoRoot"

# 2. Check docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Err "Docker is not found on PATH. Please install/start Docker."
    exit 1
}

# 3. Determine tag (default: latest)
if (-not $Tag) {
    $Tag = 'latest'
}

if (-not $ApiBaseUrl) { $ApiBaseUrl = $PublicUrl }
if (-not $SiteUrl) { $SiteUrl = $PublicUrl }

$BackendRepo = "$HubUser/calibration-be"
$FrontendRepo = "$HubUser/calibration-fe"
$BackupRepo = "$HubUser/calibration-backup"

Write-Info "Configuration:"
Write-Host "  Hub User:       $HubUser"
Write-Host "  Primary Tag:    latest"
if ($Tag -ne 'latest') {
    Write-Host "  Additional Tag: $Tag"
}
Write-Host "  Service:        $Service"
Write-Host "  Push to Hub:    $(-not $NoPush)"
Write-Host "  Public URL:     $PublicUrl"

function Run-Command([string]$cmd, [string[]]$cmdArgs) {
    Write-Host "> $cmd $($cmdArgs -join ' ')" -ForegroundColor DarkGray
    & $cmd @cmdArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Command failed with exit code ${LASTEXITCODE}: $cmd $($cmdArgs -join ' ')"
        exit $LASTEXITCODE
    }
}

# 4. Build Images
# 4a. Backend
if ($Service -eq 'all' -or $Service -eq 'backend') {
    Write-Info "Building Backend Image (${BackendRepo}:latest)..."
    $buildArgs = @('build', '-f', 'backend/Dockerfile', '-t', "${BackendRepo}:latest")
    if ($Tag -and $Tag -ne 'latest') { $buildArgs += @('-t', "${BackendRepo}:${Tag}") }
    $buildArgs += @('.')
    Run-Command 'docker' $buildArgs
    Write-Success "Backend built successfully."
}

# 4b. Frontend
if ($Service -eq 'all' -or $Service -eq 'frontend') {
    Write-Info "Building Frontend Image (${FrontendRepo}:latest)..."
    $buildArgs = @('build', '-f', 'frontend/Dockerfile', '-t', "${FrontendRepo}:latest")
    if ($Tag -and $Tag -ne 'latest') { $buildArgs += @('-t', "${FrontendRepo}:${Tag}") }
    $buildArgs += @(
        '--build-arg', "NEXT_PUBLIC_API_BASE_URL=$ApiBaseUrl",
        '--build-arg', "NEXT_PUBLIC_SITE_URL=$SiteUrl",
        '--build-arg', "NEXT_PUBLIC_API_VERSION=$ApiVersion",
        '--build-arg', "NEXT_PUBLIC_TENANT_ID=$TenantId",
        '--build-arg', "NEXT_PUBLIC_CONTACT_WHATSAPP=$ContactWhatsapp",
        '--build-arg', "NEXT_PUBLIC_CONTACT_EMAIL=$ContactEmail",
        '.'
    )
    Run-Command 'docker' $buildArgs
    Write-Success "Frontend built successfully."
}

# 4c. Backup Verifier
if ($Service -eq 'all' -or $Service -eq 'backup') {
    Write-Info "Building Backup Verifier Image (${BackupRepo}:latest)..."
    $buildArgs = @('build', '-f', 'deploy/backup/Dockerfile', '-t', "${BackupRepo}:latest")
    if ($Tag -and $Tag -ne 'latest') { $buildArgs += @('-t', "${BackupRepo}:${Tag}") }
    $buildArgs += @(
        '--build-context', "backend-image=docker-image://${BackendRepo}:latest",
        '.'
    )
    Run-Command 'docker' $buildArgs
    Write-Success "Backup verifier built successfully."
}

# 5. Push Images
if ($NoPush) {
    Write-Info "Skipping push (-NoPush specified)."
    exit 0
}

Write-Info "Pushing images to Docker Hub..."

function Push-Image([string]$repo) {
    Write-Info "Pushing ${repo}:latest..."
    Run-Command 'docker' @('push', "${repo}:latest")
    if ($Tag -and $Tag -ne 'latest') {
        Write-Info "Pushing ${repo}:${Tag}..."
        Run-Command 'docker' @('push', "${repo}:${Tag}")
    }
}

if ($Service -eq 'all' -or $Service -eq 'backend') { Push-Image $BackendRepo }
if ($Service -eq 'all' -or $Service -eq 'frontend') { Push-Image $FrontendRepo }
if ($Service -eq 'all' -or $Service -eq 'backup') { Push-Image $BackupRepo }

Write-Success "`nAll images successfully built and pushed to Docker Hub with tag :latest!"
Write-Host "Images available:"
if ($Service -eq 'all' -or $Service -eq 'backend') { Write-Host "  - ${BackendRepo}:latest $(if ($Tag -ne 'latest') { "(${BackendRepo}:$Tag)" })" }
if ($Service -eq 'all' -or $Service -eq 'frontend') { Write-Host "  - ${FrontendRepo}:latest $(if ($Tag -ne 'latest') { "(${FrontendRepo}:$Tag)" })" }
if ($Service -eq 'all' -or $Service -eq 'backup') { Write-Host "  - ${BackupRepo}:latest $(if ($Tag -ne 'latest') { "(${BackupRepo}:$Tag)" })" }
