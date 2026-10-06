#Requires -Version 5.1
<#
.SYNOPSIS
    Build, secret-scan and push the three Callibrator images to Docker Hub with
    consistent tags: `latest` and the short commit (ADR-123).

.DESCRIPTION
    The release path for the images that docker-compose.yml, the VM overlay and
    the Helm chart PULL. Run it from PowerShell or cmd (`pwsh -File ...`), not
    Git Bash: Docker Desktop's credential store is visible to `docker push` only
    there. Log in first with `docker login`.

      1. Refuses a dirty tree: a tracked change anywhere, or an untracked file
         inside what the images are built from. An image tagged with a commit
         must be built from exactly that commit.
      2. Builds in dependency order: backend -> frontend -> backup verifier
         (FROM the backend image just built, --build-context backend-image=...).
      3. Scans every image before anything is pushed: no .env / .pem (except the
         CA trust store) / .key / id_rsa / .npmrc carrying auth / .git in the
         filesystem, no secret-named variable with a value in its environment,
         no literal secret in `docker history`. The frontend must carry the URL
         it was built for. Any finding stops the release.
      4. Pushes <sha> then latest for each image, and prints the digests, in the
         compose (.env) and Helm forms, for pinning a deployment.

    THE FRONTEND IMAGE IS DEPLOYMENT-SPECIFIC. Next.js inlines NEXT_PUBLIC_* at
    build time, so the frontend serves exactly one public URL. The defaults build
    the reference deployment's (https://kalibrasi.zedth.my.id). A frontend for
    any other URL goes to a repository of its own (-FrontendRepository): the
    script refuses to push one into the reference repository.

.PARAMETER PublicUrl
    The public origin the frontend is built for. Default: the reference deployment.
.PARAMETER ApiBaseUrl
    NEXT_PUBLIC_API_BASE_URL. Default: -PublicUrl.
.PARAMETER SiteUrl
    NEXT_PUBLIC_SITE_URL. Default: -PublicUrl.
.PARAMETER NoPush
    Build and scan only (alias -DryRun). Allowed on a dirty tree, in which case
    the tag is <sha>-dirty and `latest` is not applied.
.PARAMETER NoLatest
    Push only the <sha> tag, leaving `latest` where it is.
.PARAMETER ScanTag
    Scan only: run step 4 against <repository>:<ScanTag> for the three
    repositories, building and pushing nothing (e.g. -ScanTag 3e91413 re-checks
    a published release; the images must be present locally - pull them first).

.EXAMPLE
    pwsh -File scripts/release/push-images.ps1
    # the reference release: zed378/calibration-{be,fe,backup}:{<sha>,latest}

.EXAMPLE
    pwsh -File scripts/release/push-images.ps1 -DryRun
    # build + scan, push nothing

.EXAMPLE
    pwsh -File scripts/release/push-images.ps1 -ScanTag 3e91413
    # re-scan an existing release, no build, no push

.EXAMPLE
    pwsh -File scripts/release/push-images.ps1 -PublicUrl https://cal.example.org `
        -FrontendRepository acme/calibration-fe-example
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
    Justification = 'An interactive release script: its progress and findings are for the operator at the console, not the pipeline.')]
[CmdletBinding()]
param(
    [string]$BackendRepository = 'zed378/calibration-be',
    [string]$FrontendRepository = 'zed378/calibration-fe',
    [string]$BackupRepository = 'zed378/calibration-backup',
    [string]$PublicUrl = 'https://kalibrasi.zedth.my.id',
    [string]$ApiBaseUrl = '',
    [string]$SiteUrl = '',
    [string]$ApiVersion = 'v1',
    [string]$TenantId = '',
    [string]$ContactWhatsapp = '',
    [string]$ContactEmail = '',
    [Alias('DryRun')]
    [switch]$NoPush,
    [switch]$NoLatest,
    [string]$ScanTag = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The reference deployment that the default frontend repository serves (ADR-123).
$ReferenceFrontendRepository = 'zed378/calibration-fe'
$ReferenceUrl = 'https://kalibrasi.zedth.my.id'

if (-not $ApiBaseUrl) { $ApiBaseUrl = $PublicUrl }
if (-not $SiteUrl) { $SiteUrl = $PublicUrl }

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Warn([string]$Message) { Write-Host "WARNING: $Message" -ForegroundColor Yellow }
function Exit-Release([string]$Message) {
    Write-Host "REFUSED: $Message" -ForegroundColor Red
    exit 1
}

# Run a native command with an explicit argument ARRAY (never through PowerShell
# parameter binding, which would read `-f` as -File and swallow `--`); stop the
# release on a non-zero exit.
function Invoke-Native([string]$File, [string[]]$ArgumentList) {
    & $File @ArgumentList
    if ($LASTEXITCODE -ne 0) { Exit-Release "$File $($ArgumentList -join ' ') exited $LASTEXITCODE" }
}

# The same, returning stdout as an array of lines.
function Get-NativeOutput([string]$File, [string[]]$ArgumentList) {
    $out = & $File @ArgumentList
    if ($LASTEXITCODE -ne 0) { Exit-Release "$File $($ArgumentList -join ' ') exited $LASTEXITCODE" }
    return @($out)
}

# ---------------------------------------------------------------------------
# 0. Where, and with what
# ---------------------------------------------------------------------------
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $RepoRoot
foreach ($tool in 'git', 'docker') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Exit-Release "$tool is not on PATH." }
}
foreach ($dockerfile in 'backend/Dockerfile', 'frontend/Dockerfile', 'deploy/backup/Dockerfile') {
    if (-not (Test-Path $dockerfile)) { Exit-Release "$dockerfile not found under $RepoRoot." }
}

$images = [ordered]@{
    backend  = $BackendRepository
    frontend = $FrontendRepository
    backup   = $BackupRepository
}
if ($ScanTag) {
    # Scan only (step 4): nothing is built, tagged or pushed.
    $Tag = $ScanTag
    $applyLatest = $false
    Write-Step "Scan only: $($images.backend):$Tag, $($images.frontend):$Tag, $($images.backup):$Tag"
} else {
    # ---------------------------------------------------------------------------
    # 1. A clean tree, and the tag it earns
    # ---------------------------------------------------------------------------
    Write-Step 'Checking the tree'
    $fullSha = @(Get-NativeOutput git @('rev-parse', 'HEAD'))[0].Trim()
    $shortSha = @(Get-NativeOutput git @('rev-parse', '--short=7', 'HEAD'))[0].Trim()

    # Tracked changes anywhere, staged or not.
    $tracked = @(Get-NativeOutput git @('status', '--porcelain', '--untracked-files=no') | Where-Object { $_ })
    # Untracked, non-ignored files INSIDE the build inputs (the Dockerfile.dockerignore
    # allow-lists). An untracked file elsewhere (an editor folder) cannot enter an
    # image, so it only warns.
    $inputs = @('package.json', 'package-lock.json', 'backend', 'frontend', 'packages/contracts', 'deploy/backup')
    $untrackedInputs = @(Get-NativeOutput git (@('status', '--porcelain', '--untracked-files=all', '--') + $inputs) | Where-Object { $_ -like '`?`? *' })
    $untrackedElsewhere = @(Get-NativeOutput git @('status', '--porcelain', '--untracked-files=all') | Where-Object { $_ -like '`?`? *' })

    $dirty = ($tracked.Count + $untrackedInputs.Count) -gt 0
    if ($dirty) {
        Write-Host 'The tree is not clean:'
        ($tracked + $untrackedInputs) | Select-Object -First 30 | ForEach-Object { Write-Host "  $_" }
        if (-not $NoPush) {
            Exit-Release "an image tagged $shortSha must be built from exactly $shortSha. Commit or stash, then rerun (or rerun with -NoPush to build and scan only)."
        }
        $Tag = "$shortSha-dirty"
        Write-Warn "-NoPush on a dirty tree: tagging $Tag, and NOT latest."
    } else {
        $Tag = $shortSha
    }
    if ($untrackedElsewhere.Count -gt $untrackedInputs.Count) {
        Write-Warn 'untracked files outside the image inputs (they cannot enter an image):'
        $untrackedElsewhere | Where-Object { $untrackedInputs -notcontains $_ } | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" }
    }
    $applyLatest = (-not $NoLatest) -and (-not $dirty)

    $remoteBranches = @(& git branch -r --contains HEAD 2>$null | Where-Object { $_ })
    if ($remoteBranches.Count -eq 0) {
        Write-Warn "commit $shortSha is on no remote branch: the tag will name a commit nobody else can check out. Push the commit too."
    }

    # ---------------------------------------------------------------------------
    # 2. The frontend is built for ONE URL
    # ---------------------------------------------------------------------------
    $isReferenceFrontend = ($FrontendRepository -eq $ReferenceFrontendRepository)
    $urlIsReference = ($ApiBaseUrl.TrimEnd('/') -eq $ReferenceUrl) -and ($SiteUrl.TrimEnd('/') -eq $ReferenceUrl)
    if ($isReferenceFrontend -and -not $urlIsReference -and -not $NoPush) {
        Exit-Release "$ReferenceFrontendRepository serves $ReferenceUrl, and every deployment pulling it would get the API URL '$ApiBaseUrl'. Push a frontend for another URL to its own repository: -FrontendRepository <namespace>/<name>."
    }
    Write-Host ''
    Write-Warn 'the FRONTEND image is deployment-specific. NEXT_PUBLIC_* are inlined at build time:'
    Write-Host "    NEXT_PUBLIC_API_BASE_URL = $ApiBaseUrl"
    Write-Host "    NEXT_PUBLIC_SITE_URL     = $SiteUrl"
    Write-Host "    NEXT_PUBLIC_API_VERSION  = $ApiVersion"
    Write-Host "    NEXT_PUBLIC_TENANT_ID    = $(if ($TenantId) { $TenantId } else { '(empty: multi-tenant)' })"
    Write-Host "    contact channels         = $(if ($ContactWhatsapp -or $ContactEmail) { 'set' } else { '(empty: hidden)' })"
    Write-Host "  A deployment at any other URL needs its own frontend image. Backend and backup images are generic."

    function Get-TagArgumentList([string]$Repository) {
        $tagArgs = @('-t', "${Repository}:$Tag")
        if ($applyLatest) { $tagArgs += @('-t', "${Repository}:latest") }
        return $tagArgs
    }

    $created = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $labels = @(
        '--label', "org.opencontainers.image.revision=$fullSha",
        '--label', "org.opencontainers.image.created=$created",
        '--label', 'org.opencontainers.image.vendor=Callibrator'
    )

    # ---------------------------------------------------------------------------
    # 3. Build: backend -> frontend -> backup (FROM the backend just built)
    # ---------------------------------------------------------------------------
    Write-Step "Building $($images.backend):$Tag"
    Invoke-Native docker (@('build', '-f', 'backend/Dockerfile') + (Get-TagArgumentList $images.backend) + $labels + @(
            '--label', 'org.opencontainers.image.title=calibration-be', '.'))

    Write-Step "Building $($images.frontend):$Tag (for $ApiBaseUrl)"
    Invoke-Native docker (@('build', '-f', 'frontend/Dockerfile') + (Get-TagArgumentList $images.frontend) + $labels + @(
            '--label', 'org.opencontainers.image.title=calibration-fe',
            '--label', "org.opencontainers.image.url=$SiteUrl",
            '--build-arg', "NEXT_PUBLIC_API_BASE_URL=$ApiBaseUrl",
            '--build-arg', "NEXT_PUBLIC_SITE_URL=$SiteUrl",
            '--build-arg', "NEXT_PUBLIC_API_VERSION=$ApiVersion",
            '--build-arg', "NEXT_PUBLIC_TENANT_ID=$TenantId",
            '--build-arg', "NEXT_PUBLIC_CONTACT_WHATSAPP=$ContactWhatsapp",
            '--build-arg', "NEXT_PUBLIC_CONTACT_EMAIL=$ContactEmail", '.'))

    Write-Step "Building $($images.backup):$Tag (FROM $($images.backend):$Tag)"
    Invoke-Native docker (@('build', '-f', 'deploy/backup/Dockerfile') + (Get-TagArgumentList $images.backup) + $labels + @(
            '--label', 'org.opencontainers.image.title=calibration-backup',
            '--build-context', "backend-image=docker-image://$($images.backend):$Tag", '.'))
}

# ---------------------------------------------------------------------------
# 4. Secret scan - every image, before anything is pushed
# ---------------------------------------------------------------------------
# Paths a sensitive-looking NAME is allowed at, each for a stated reason. All
# come from the pinned BASE images, none from this repository.
$allowedPaths = @(
    '^/etc/ssl/certs/[^/]+\.pem$',                    # the CA trust store
    '^/usr/share/ca-certificates/',                    # the CA trust store (sources)
    '^/usr/local/share/ca-certificates/',              # the CA trust store (local)
    '^/usr/lib/ssl/cert\.pem$',                        # OpenSSL's CA bundle link (Debian)
    '^/etc/ssl/cert\.pem$',                            # the CA bundle (Alpine)
    '^/etc/ssl1\.1/cert\.pem$',                        # the CA bundle (Alpine, OpenSSL 1.1 compat)
    '^/usr/share/gnupg/sks-keyservers\.netCA\.pem$',   # a public CA certificate shipped by gnupg (pgvector base)
    '^/etc/ssl/certs/ssl-cert-snakeoil\.pem$',         # Debian ssl-cert's self-signed pair, generated in the
    '^/etc/ssl/private/ssl-cert-snakeoil\.key$',       #   public pgvector base image; unused, not a secret of ours
    '^/usr/local/lib/node_modules/npm/\.npmrc$'        # npm's own built-in config (Node base); auth content is checked below
)
# One line, no double quotes (Windows PowerShell 5.1 mangles them in native arguments).
$findScript = "find / \( -path /proc -o -path /sys -o -path /dev \) -prune -o \( -name .env -o -name '.env.*' -o -name '*.pem' -o -name '*.key' -o -name 'id_rsa*' -o -name 'id_dsa*' -o -name 'id_ecdsa*' -o -name 'id_ed25519*' -o -name '*.p12' -o -name '*.pfx' -o -name '*.jks' -o -name .npmrc -o -name .yarnrc -o -name .pypirc -o -name .netrc -o -name .git-credentials -o -name .git \) -print 2>/dev/null | while read -r f; do echo FILE:`$f; case `$f in *.npmrc) grep -qiE '_auth|token|password' `$f && echo AUTH:`$f;; esac; done; true"
$secretEnvName = '(?i)(secret|passw|token|api_?key|private|credential|access_?key|auth|(^|_)key$|(^|_)pass$)'
$historyPatterns = [ordered]@{
    'a private key block'               = '-----BEGIN [A-Z ]*PRIVATE KEY-----'
    'an AWS access key id'              = 'AKIA[0-9A-Z]{16}'
    'a GitHub token'                    = 'gh[pousr]_[A-Za-z0-9]{36}'
    'a Slack token'                     = 'xox[baprs]-[A-Za-z0-9-]{10,}'
    'an npm auth setting'               = '(?i)_auth(Token)?\s*='
    'credentials in a URL'              = '(?i)[a-z][a-z0-9+.-]*://[^/\s:@]+:[^/\s@]+@'
    'a secret-named variable with a literal value' = '(?i)\b[A-Z0-9_]*(SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*=\s*[''"]?[^\s''"$]{4,}'
}

$findings = New-Object System.Collections.Generic.List[string]
foreach ($name in $images.Keys) {
    $ref = "$($images[$name]):$Tag"
    Write-Step "Scanning $ref"

    # 4a. The filesystem, as root (the image's own user cannot read every
    #     directory), with no network and the entrypoint overridden.
    $lines = Get-NativeOutput docker @('run', '--rm', '--network', 'none', '--user', '0:0', '--entrypoint', 'sh', $ref, '-c', $findScript)
    $files = @($lines | Where-Object { $_ -like 'FILE:*' } | ForEach-Object { $_.Substring(5) })
    $auth = @($lines | Where-Object { $_ -like 'AUTH:*' } | ForEach-Object { $_.Substring(5) })
    $flagged = @($files | Where-Object {
            $path = $_
            -not ($allowedPaths | Where-Object { $path -match $_ })
        })
    foreach ($f in $flagged) { $findings.Add("${ref}: sensitive file name $f") }
    foreach ($f in $auth) { $findings.Add("${ref}: $f carries an auth/token/password setting") }
    Write-Host "  filesystem: $($files.Count) sensitive-looking name(s), $($files.Count - $flagged.Count) on the base-image allow-list, $($flagged.Count) flagged; $($auth.Count) .npmrc with auth"

    # 4b. The environment baked into the image config.
    $envJson = (Get-NativeOutput docker @('image', 'inspect', '--format', '{{json .Config.Env}}', $ref)) -join ''
    # Through ForEach-Object: Windows PowerShell 5.1's ConvertFrom-Json emits a JSON
    # array as ONE object, which @() alone would count as one variable.
    $envVars = @(ConvertFrom-Json $envJson | ForEach-Object { $_ })
    $badEnv = @($envVars | Where-Object {
            $pair = $_ -split '=', 2
            ($pair[0] -match $secretEnvName) -and ($pair.Count -eq 2) -and ($pair[1] -ne '')
        } | ForEach-Object { ($_ -split '=', 2)[0] })
    foreach ($v in $badEnv) { $findings.Add("${ref}: environment variable $v has a value baked in") }
    Write-Host "  environment: $($envVars.Count) variable(s), $($badEnv.Count) secret-named with a value"

    # 4c. The build history (RUN lines, ARG values used by them, ENV, LABEL).
    $history = Get-NativeOutput docker @('history', '--no-trunc', '--format', '{{.CreatedBy}}', $ref)
    $hits = 0
    foreach ($label in $historyPatterns.Keys) {
        if ($history | Where-Object { $_ -match $historyPatterns[$label] }) {
            $findings.Add("${ref}: docker history contains $label")
            $hits++
        }
    }
    Write-Host "  history: $(@($history).Count) layer(s), $hits pattern(s) matched"

    # 4d. The frontend must carry the URL it claims (inlined into the client bundle).
    if ($name -eq 'frontend') {
        $probe = "grep -rqsF $ApiBaseUrl /app/frontend/.next/static && echo URL_PRESENT || echo URL_ABSENT"
        $present = Get-NativeOutput docker @('run', '--rm', '--network', 'none', '--user', '0:0', '--entrypoint', 'sh', $ref, '-c', $probe)
        if ($present -notcontains 'URL_PRESENT') { $findings.Add("${ref}: $ApiBaseUrl is not inlined in the client bundle") }
        Write-Host "  inlined API URL: $(if ($present -contains 'URL_PRESENT') { 'present' } else { 'ABSENT' })"
    }
}

if ($findings.Count -gt 0) {
    Write-Host "`nSecret scan FAILED - nothing was pushed:" -ForegroundColor Red
    $findings | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    exit 1
}
Write-Host "`nSecret scan passed for all three images." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 5. Push, and the digests to pin
# ---------------------------------------------------------------------------
if ($NoPush -or $ScanTag) {
    Write-Step 'Built (unless -ScanTag) and scanned; nothing pushed'
    foreach ($name in $images.Keys) {
        $ref = "$($images[$name]):$Tag"
        $repoDigests = @(Get-NativeOutput docker @('image', 'inspect', '--format', '{{range .RepoDigests}}{{println .}}{{end}}', $ref) |
                Where-Object { $_ -like "$($images[$name])@sha256:*" })
        if ($repoDigests.Count -gt 0) {
            Write-Host ("  {0,-9} {1}  registry digest {2}" -f $name, $ref, ($repoDigests[0] -split '@', 2)[1])
        } else {
            $id = @(Get-NativeOutput docker @('image', 'inspect', '--format', '{{.Id}}', $ref))[0]
            Write-Host ("  {0,-9} {1}  local id {2} (never pushed: no registry digest yet)" -f $name, $ref, $id)
        }
    }
    exit 0
}

$digests = [ordered]@{}
foreach ($name in $images.Keys) {
    $repo = $images[$name]
    Write-Step "Pushing ${repo}:$Tag$(if ($applyLatest) { ' and latest' })"
    Invoke-Native docker @('push', "${repo}:$Tag")
    if ($applyLatest) { Invoke-Native docker @('push', "${repo}:latest") }
    $repoDigests = Get-NativeOutput docker @('image', 'inspect', '--format', '{{range .RepoDigests}}{{println .}}{{end}}', "${repo}:$Tag")
    $match = @($repoDigests | Where-Object { $_ -like "$repo@sha256:*" })
    if ($match.Count -eq 0) {
        # Fall back to the registry's own answer.
        $digest = @(Get-NativeOutput docker @('buildx', 'imagetools', 'inspect', "${repo}:$Tag", '--format', '{{.Manifest.Digest}}'))[0].Trim()
    } else {
        $digest = ($match[0] -split '@', 2)[1].Trim()
    }
    $digests[$name] = $digest
}

Write-Host "`nPushed (tag $Tag$(if ($applyLatest) { ', latest' })):" -ForegroundColor Green
foreach ($name in $images.Keys) { Write-Host ("  {0}:{1}@{2}" -f $images[$name], $Tag, $digests[$name]) }
Write-Host "`nPin a compose deployment (deploy/compose/.env):"
Write-Host "  IMAGE_TAG=$Tag"
Write-Host "  BACKEND_DIGEST=$($digests.backend)"
Write-Host "  FRONTEND_DIGEST=$($digests.frontend)"
Write-Host "  BACKUP_DIGEST=$($digests.backup)"
Write-Host "Pin a Helm release:"
Write-Host "  --set backend.image.tag=$Tag --set backend.image.digest=$($digests.backend) ``"
Write-Host "  --set frontend.image.tag=$Tag --set frontend.image.digest=$($digests.frontend) ``"
Write-Host "  --set backupVerify.image.digest=$($digests.backup)"
Write-Warn "the frontend digest above serves $ApiBaseUrl only."
