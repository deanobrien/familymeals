# redeploy.ps1 - build the App Service package from the repo and deploy it
$ErrorActionPreference = 'Stop'
Set-Location C:\TFS\FamilyRecipes

# 1. Build the zip with the public Supabase values and site URL from .env.cloud
Remove-Item Env:E2E_PRODUCTION_BUILD -ErrorAction SilentlyContinue
Get-Content .env.cloud | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object {
  $k, $v = $_ -split '=', 2; Set-Item -Path "env:$k" -Value $v }
$buildRoot = Join-Path $env:TEMP ('fr-appservice-build-' + (Get-Date -Format 'yyyyMMddHHmmss'))
Write-Host "Building package (5-10 min)..."
powershell -ExecutionPolicy Bypass -File scripts\package-appservice.ps1 -BuildRoot $buildRoot
if ($LASTEXITCODE -ne 0) { throw "Package build failed" }
$commit = git rev-parse --short HEAD
Write-Host ("Built dist\appservice.zip ({0:N1} MB) from commit $commit" -f ((Get-Item dist\appservice.zip).Length / 1MB))

# 2. Deploy to App Service using your personal Azure sign-in
$env:AZURE_CONFIG_DIR = "$env:USERPROFILE\.azure-personal"
$sub = az account show --query name -o tsv
Write-Host "Subscription: $sub"
if ($sub -eq 'UNN-TEST-UAT-WEB') { throw 'Wrong subscription - run: az login --use-device-code' }
$scm  = 'https://family-recipes-dean-cph4g5cuh9fmhhfy.scm.ukwest-01.azurewebsites.net'
$site = 'https://family-recipes-dean-cph4g5cuh9fmhhfy.ukwest-01.azurewebsites.net'
$h = @{ Authorization = "Bearer $(az account get-access-token --query accessToken -o tsv)" }

Write-Host 'Uploading (clean deploy + restart)...'
Invoke-WebRequest -UseBasicParsing -Method POST -Uri "$scm/api/publish?type=zip&clean=true&restart=true" `
  -InFile dist\appservice.zip -ContentType 'application/zip' -Headers $h -TimeoutSec 900 | Out-Null
do { Start-Sleep 10; $d = Invoke-RestMethod -Uri "$scm/api/deployments/latest" -Headers $h
     Write-Host "  status=$($d.status) complete=$($d.complete)" } until ($d.complete)
if ($d.status -ne 4) { throw "Deployment failed (status $($d.status))" }

# 3. Wait for the app to report healthy
Write-Host 'Waiting for the app to start (up to 5 min)...'
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep 10
  try { $r = Invoke-WebRequest -UseBasicParsing "$site/api/health" -TimeoutSec 30; Write-Host $r.Content; break }
  catch { Write-Host "  not ready yet" }
}