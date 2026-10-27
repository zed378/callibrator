@echo off
setlocal EnableDelayedExpansion

REM =============================================================================
REM Callibrator - Build Docker Images and Push to Docker Hub (Command Prompt / Batch)
REM =============================================================================
REM Usage:
REM   build-push.bat [options]
REM
REM Options:
REM   --tag <tag>             Image tag (default: git short SHA or 'latest')
REM   --user <username>       Docker Hub user/org (default: zed378)
REM   --service <svc>         'all', 'backend', 'frontend', 'backup' (default: all)
REM   --public-url <url>      Frontend public URL (default: https://kalibrasi.zedth.my.id)
REM   --no-push               Build images only; do not push
REM   --no-latest             Do not tag or push 'latest'
REM   -h, --help              Show this help message
REM =============================================================================

set "HUB_USER=zed378"
set "TAG=latest"
set "SERVICE=all"
set "PUBLIC_URL=https://kalibrasi.zedth.my.id"
set "API_BASE_URL="
set "SITE_URL="
set "API_VERSION=v1"
set "TENANT_ID="
set "CONTACT_WHATSAPP="
set "CONTACT_EMAIL="
set "NO_PUSH=0"

:parse_args
if "%~1"=="" goto after_args
if /i "%~1"=="--tag" (
    set "TAG=%~2"
    shift
    shift
    goto parse_args
)
if /i "%~1"=="--user" (
    set "HUB_USER=%~2"
    shift
    shift
    goto parse_args
)
if /i "%~1"=="--service" (
    set "SERVICE=%~2"
    shift
    shift
    goto parse_args
)
if /i "%~1"=="--public-url" (
    set "PUBLIC_URL=%~2"
    shift
    shift
    goto parse_args
)
if /i "%~1"=="--no-push" (
    set "NO_PUSH=1"
    shift
    goto parse_args
)
if /i "%~1"=="-h" goto show_help
if /i "%~1"=="--help" goto show_help

REM Positional argument support: 1st arg tag, 2nd user, 3rd service
if "%TAG%"=="latest" (
    set "TAG=%~1"
    shift
    goto parse_args
)
shift
goto parse_args

:show_help
echo Callibrator - Docker Build and Push Script (CMD/BAT)
echo.
echo Usage: %~nx0 [options]
echo.
echo Options:
echo   --tag ^<tag^>             Additional tag (default: latest only)
echo   --user ^<username^>       Docker Hub username/org (default: zed378)
echo   --service ^<svc^>         Service to build: 'all', 'backend', 'frontend', 'backup' (default: all)
echo   --public-url ^<url^>      Frontend URL (default: https://kalibrasi.zedth.my.id)
echo   --no-push               Build only; do not push to registry
echo   -h, --help              Show this help
exit /b 0

:after_args

REM 1. Set repository root to parent of deploy/
cd /d "%~dp0\.."
set "REPO_ROOT=%CD%"
echo.
echo ==^> Working directory: %REPO_ROOT%

REM 2. Check docker
where docker >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker command not found. Please install/start Docker Desktop.
    exit /b 1
)

REM 3. Determine tag (default: latest)
if "%TAG%"=="" (
    set "TAG=latest"
)

if "%API_BASE_URL%"=="" set "API_BASE_URL=%PUBLIC_URL%"
if "%SITE_URL%"=="" set "SITE_URL=%PUBLIC_URL%"

set "BACKEND_REPO=%HUB_USER%/calibration-be"
set "FRONTEND_REPO=%HUB_USER%/calibration-fe"
set "BACKUP_REPO=%HUB_USER%/calibration-backup"

echo ==^> Configuration:
echo   Hub User:       %HUB_USER%
echo   Primary Tag:    latest
if not "%TAG%"=="latest" echo   Additional Tag: %TAG%
echo   Service:        %SERVICE%
echo   Push to Hub:    %NO_PUSH% (0=Yes, 1=No)
echo   Public URL:     %PUBLIC_URL%
echo.

REM 4. Build Images
REM 4a. Backend
if /i "%SERVICE%"=="all" goto build_backend
if /i "%SERVICE%"=="backend" goto build_backend
goto skip_backend

:build_backend
echo ==^> Building Backend (%BACKEND_REPO%:latest)...
if not "%TAG%"=="latest" (
    docker build -f backend/Dockerfile -t "%BACKEND_REPO%:latest" -t "%BACKEND_REPO%:%TAG%" .
) else (
    docker build -f backend/Dockerfile -t "%BACKEND_REPO%:latest" .
)
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Backend build failed.
    exit /b %ERRORLEVEL%
)
echo [OK] Backend built successfully.
:skip_backend

REM 4b. Frontend
if /i "%SERVICE%"=="all" goto build_frontend
if /i "%SERVICE%"=="frontend" goto build_frontend
goto skip_frontend

:build_frontend
echo ==^> Building Frontend (%FRONTEND_REPO%:latest)...
if not "%TAG%"=="latest" (
    docker build -f frontend/Dockerfile -t "%FRONTEND_REPO%:latest" -t "%FRONTEND_REPO%:%TAG%" ^
        --build-arg "NEXT_PUBLIC_API_BASE_URL=%API_BASE_URL%" ^
        --build-arg "NEXT_PUBLIC_SITE_URL=%SITE_URL%" ^
        --build-arg "NEXT_PUBLIC_API_VERSION=%API_VERSION%" ^
        --build-arg "NEXT_PUBLIC_TENANT_ID=%TENANT_ID%" ^
        --build-arg "NEXT_PUBLIC_CONTACT_WHATSAPP=%CONTACT_WHATSAPP%" ^
        --build-arg "NEXT_PUBLIC_CONTACT_EMAIL=%CONTACT_EMAIL%" .
) else (
    docker build -f frontend/Dockerfile -t "%FRONTEND_REPO%:latest" ^
        --build-arg "NEXT_PUBLIC_API_BASE_URL=%API_BASE_URL%" ^
        --build-arg "NEXT_PUBLIC_SITE_URL=%SITE_URL%" ^
        --build-arg "NEXT_PUBLIC_API_VERSION=%API_VERSION%" ^
        --build-arg "NEXT_PUBLIC_TENANT_ID=%TENANT_ID%" ^
        --build-arg "NEXT_PUBLIC_CONTACT_WHATSAPP=%CONTACT_WHATSAPP%" ^
        --build-arg "NEXT_PUBLIC_CONTACT_EMAIL=%CONTACT_EMAIL%" .
)
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Frontend build failed.
    exit /b %ERRORLEVEL%
)
echo [OK] Frontend built successfully.
:skip_frontend

REM 4c. Backup Verifier
if /i "%SERVICE%"=="all" goto build_backup
if /i "%SERVICE%"=="backup" goto build_backup
goto skip_backup

:build_backup
echo ==^> Building Backup Verifier (%BACKUP_REPO%:latest)...
if not "%TAG%"=="latest" (
    docker build -f deploy/backup/Dockerfile -t "%BACKUP_REPO%:latest" -t "%BACKUP_REPO%:%TAG%" ^
        --build-context "backend-image=docker-image://%BACKEND_REPO%:latest" .
) else (
    docker build -f deploy/backup/Dockerfile -t "%BACKUP_REPO%:latest" ^
        --build-context "backend-image=docker-image://%BACKEND_REPO%:latest" .
)
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Backup verifier build failed.
    exit /b %ERRORLEVEL%
)
echo [OK] Backup verifier built successfully.
:skip_backup

REM 5. Push Images
if "%NO_PUSH%"=="1" (
    echo.
    echo ==^> Build completed. Skipping push (--no-push specified).
    exit /b 0
)

echo.
echo ==^> Pushing images to Docker Hub...

if /i "%SERVICE%"=="all" goto push_backend
if /i "%SERVICE%"=="backend" goto push_backend
goto skip_push_backend

:push_backend
echo Pushing %BACKEND_REPO%:latest...
docker push "%BACKEND_REPO%:latest"
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
if not "%TAG%"=="latest" (
    echo Pushing %BACKEND_REPO%:%TAG%...
    docker push "%BACKEND_REPO%:%TAG%"
    if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
)
:skip_push_backend

if /i "%SERVICE%"=="all" goto push_frontend
if /i "%SERVICE%"=="frontend" goto push_frontend
goto skip_push_frontend

:push_frontend
echo Pushing %FRONTEND_REPO%:latest...
docker push "%FRONTEND_REPO%:latest"
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
if not "%TAG%"=="latest" (
    echo Pushing %FRONTEND_REPO%:%TAG%...
    docker push "%FRONTEND_REPO%:%TAG%"
    if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
)
:skip_push_frontend

if /i "%SERVICE%"=="all" goto push_backup
if /i "%SERVICE%"=="backup" goto push_backup
goto skip_push_backup

:push_backup
echo Pushing %BACKUP_REPO%:latest...
docker push "%BACKUP_REPO%:latest"
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
if not "%TAG%"=="latest" (
    echo Pushing %BACKUP_REPO%:%TAG%...
    docker push "%BACKUP_REPO%:%TAG%"
    if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
)
:skip_push_backup

echo.
echo [OK] All images built and pushed successfully to Docker Hub with tag :latest!
exit /b 0
