<#
.SYNOPSIS
  Builds the Azure App Service (Linux, Node 22, x64) deployment zip from Windows. No symlink/admin rights, no CI.

.DESCRIPTION
  1. Copies the working tree (not node_modules/.next/.git) to a SHORT build root (default %TEMP%\fr-appservice-build).
  2. Installs there with pnpm node-linker=hoisted (real folders, so Next's standalone copy needs no symlink rights,
     which Windows without Developer Mode refuses) and supportedArchitectures from package.json (linux x64 glibc sharp).
  3. Builds Next with NEXT_STANDALONE=1 (+ NEXT_PUBLIC_* baked in), copies .next/static and public into the standalone
     output, prunes non-Linux native binaries, verifies the linux sharp binaries are present.
  4. Zips to dist\appservice.zip with forward-slash entries (tar.exe/bsdtar, NOT Compress-Archive which writes
     backslashes that break on Linux).

  Required (environment variables, or apps/web/.env.production.local, which Next loads at build):
    NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY   (public values; baked into the build)
  Never put secrets (service role key, APP_SECRET, AI keys) in the zip: they are App Service application settings.

  Run from the repo root:   pwsh -File scripts\package-appservice.ps1     (or powershell -File ...)
  Output:                   <repo>\dist\appservice.zip   (start command: node apps/web/server.js)
#>
[CmdletBinding()]
param(
  [string]$BuildRoot = (Join-Path $env:TEMP 'fr-appservice-build'),
  [switch]$SkipInstall
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dist = Join-Path $repo 'dist'
$zip = Join-Path $dist 'appservice.zip'

function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Run($exe, [string[]]$a) {
  & $exe @a
  if ($LASTEXITCODE -ne 0) { throw "$exe $($a -join ' ') failed with exit code $LASTEXITCODE" }
}

# --- public build-time env -------------------------------------------------------------------------------------------
$envFile = Join-Path $repo 'apps\web\.env.production.local'
$fromFile = @{}
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object { if ($_ -match '^\s*(NEXT_PUBLIC_[A-Z_]+)\s*=\s*(.*?)\s*$') { $fromFile[$Matches[1]] = $Matches[2].Trim('"') } }
}
foreach ($n in 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY') {
  if (-not [Environment]::GetEnvironmentVariable($n) -and $fromFile[$n]) { [Environment]::SetEnvironmentVariable($n, $fromFile[$n]) }
  if (-not [Environment]::GetEnvironmentVariable($n)) {
    throw "$n is not set. Set it in this shell or in apps\web\.env.production.local (public Supabase values; baked into the build)."
  }
}
$env:NEXT_STANDALONE = '1'
try { $env:APP_COMMIT = (git -C $repo rev-parse --short HEAD).Trim() } catch { $env:APP_COMMIT = 'unknown' }

# --- 1. copy the working tree -----------------------------------------------------------------------------------------
Step "Copying sources to $BuildRoot"
if (-not $SkipInstall -and (Test-Path $BuildRoot)) { Remove-Item -Recurse -Force $BuildRoot }
New-Item -ItemType Directory -Force $BuildRoot | Out-Null
# /XD matches by NAME at any depth; keep .data/.next/dist/.git/node_modules out. Exit codes < 8 are success for robocopy.
robocopy $repo $BuildRoot /MIR /NFL /NDL /NJH /NJS /NP /XD node_modules .next .next-e2e .git dist .data .data-e2e .turbo .claude coverage test-results playwright-report /XF .env .env.local .env.*.local | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
$global:LASTEXITCODE = 0
# the public values are passed as process env; the secrets-bearing .env files were excluded above on purpose.
Set-Content -Path (Join-Path $BuildRoot '.npmrc') -Value "node-linker=hoisted`nstrict-peer-dependencies=false" -Encoding ascii

# --- 2. install (hoisted, linux sharp) --------------------------------------------------------------------------------
Push-Location $BuildRoot
try {
  if (-not $SkipInstall) {
    Step 'pnpm install (hoisted, only @fr/web and its dependencies)'
    Run 'pnpm' @('install', '--frozen-lockfile', '--ignore-scripts', '--filter', '@fr/web...')
  }

  # --- 3. build -------------------------------------------------------------------------------------------------------
  Step 'next build (standalone)'
  Run 'pnpm' @('--filter', '@fr/web', 'exec', 'next', 'build')
} finally { Pop-Location }

$standalone = Join-Path $BuildRoot 'apps\web\.next\standalone'
$server = Join-Path $standalone 'apps\web\server.js'
if (-not (Test-Path $server)) { throw "Standalone output missing: $server" }

Step 'Adding .next/static and public'
$webOut = Join-Path $standalone 'apps\web'
New-Item -ItemType Directory -Force (Join-Path $webOut '.next') | Out-Null
Copy-Item -Recurse -Force (Join-Path $BuildRoot 'apps\web\.next\static') (Join-Path $webOut '.next\static')
$pub = Join-Path $BuildRoot 'apps\web\public'
if (Test-Path $pub) { Copy-Item -Recurse -Force $pub (Join-Path $webOut 'public') }

# --- linux sharp ----------------------------------------------------------------------------------------------------------
Step 'Ensuring linux-x64 sharp binaries'
$img = Join-Path $standalone 'node_modules\@img'
foreach ($need in 'sharp-linux-x64', 'sharp-libvips-linux-x64') {
  $dst = Join-Path $img $need
  if (-not (Test-Path $dst)) {
    $src = Join-Path $BuildRoot "node_modules\@img\$need"
    if (-not (Test-Path $src)) { throw "$need is not installed in the build root: check package.json pnpm.supportedArchitectures" }
    New-Item -ItemType Directory -Force $img | Out-Null
    Copy-Item -Recurse -Force $src $dst
  }
}
# drop binaries that cannot run on the Linux glibc target
Get-ChildItem $img -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'win32|darwin|linuxmusl|linux-arm|linux-s390x|linux-ppc64|linux-riscv|wasm' } |
  ForEach-Object { Remove-Item -Recurse -Force $_.FullName }
if (-not (Get-ChildItem (Join-Path $img 'sharp-linux-x64') -Recurse -Filter '*.node')) { throw 'sharp linux-x64 .node binary missing' }
if (-not (Get-ChildItem (Join-Path $img 'sharp-libvips-linux-x64') -Recurse -Filter 'libvips*')) { throw 'libvips linux-x64 missing' }

# --- 3b. make it impossible for App Service (Kudu/Oryx) to run a server-side build ----------------------------------------
# Oryx detects a root package.json with a build script and runs `npm install` + `npm run build` (-> turbo: not found).
Step 'Sanitising package.json, lockfiles, .deployment'
$rootPkgPath = Join-Path $standalone 'package.json'
$ver = '0.0.0'
try { $ver = (Get-Content (Join-Path $BuildRoot 'package.json') -Raw | ConvertFrom-Json).version } catch {}
if (-not $ver) { $ver = '0.0.0' }
$rootPkg = [ordered]@{ name = 'family-recipes-appservice'; version = $ver; private = $true; scripts = [ordered]@{ start = 'node apps/web/server.js' } }
[IO.File]::WriteAllText($rootPkgPath, ($rootPkg | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
$webPkgPath = Join-Path $standalone 'apps\web\package.json'
if (Test-Path $webPkgPath) {
  $w = Get-Content $webPkgPath -Raw | ConvertFrom-Json
  $min = [ordered]@{ name = $w.name; version = $w.version; private = $true; scripts = [ordered]@{ start = 'node server.js' } }
  [IO.File]::WriteAllText($webPkgPath, ($min | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
}
foreach ($lock in 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'pnpm-workspace.yaml', 'turbo.json', '.npmrc') {
  Remove-Item -Force (Join-Path $standalone $lock) -ErrorAction SilentlyContinue
}
[IO.File]::WriteAllText((Join-Path $standalone '.deployment'), "[config]`nSCM_DO_BUILD_DURING_DEPLOYMENT=false`n", (New-Object Text.UTF8Encoding($false)))

# --- 4. zip (forward-slash entries) -------------------------------------------------------------------------------------
Step "Zipping to $zip"
New-Item -ItemType Directory -Force $dist | Out-Null
if (Test-Path $zip) { Remove-Item -Force $zip }
Run (Join-Path $env:SystemRoot 'System32\tar.exe') @('-a', '-c', '-f', $zip, '-C', $standalone, '.')
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ''
Write-Host "Package:  $zip  ($mb MB)" -ForegroundColor Green
Write-Host 'Startup command: node apps/web/server.js'
Write-Host 'Deploy: az webapp deploy --resource-group <rg> --name <app> --src-path dist\appservice.zip --type zip'
