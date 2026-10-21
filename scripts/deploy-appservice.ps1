<#
.SYNOPSIS
  Uploads dist\appservice.zip to the Azure App Service (Kudu zip publish, clean + restart), waits, then checks /api/health.
  Contains no secrets: it uses your own Azure CLI login. Windows PowerShell 5.1 or pwsh.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\deploy-appservice.ps1
  powershell -ExecutionPolicy Bypass -File scripts\deploy-appservice.ps1 -ExpectedSubscription 'My personal sub'

.NOTES
  Defaults are the owner's public hostnames. Override for another App Service.
  If the machine also has an employer Azure login, use a separate config dir (see docs/DEPLOY-APP-SERVICE.md step 0):
  the script sets AZURE_CONFIG_DIR to -AzureConfigDir (default %USERPROFILE%\.azure-personal) for this process only.
  Build the zip first with scripts\package-appservice.ps1 (load .env.cloud first, use a fresh -BuildRoot).
#>
[CmdletBinding()]
param(
  [string]$Scm  = 'https://family-recipes-dean-cph4g5cuh9fmhhfy.scm.ukwest-01.azurewebsites.net',
  [string]$Site = 'https://family-recipes-dean-cph4g5cuh9fmhhfy.ukwest-01.azurewebsites.net',
  [string]$Zip  = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path 'dist\appservice.zip'),
  [string]$AzureConfigDir = (Join-Path $env:USERPROFILE '.azure-personal'),
  [string]$ForbiddenSubscription = 'UNN-TEST-UAT-WEB'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Zip)) { throw "Zip not found: $Zip (run scripts\package-appservice.ps1 first)" }
$env:AZURE_CONFIG_DIR = $AzureConfigDir

$sub = az account show --query name -o tsv
Write-Host "Subscription: $sub"
if ($sub -eq $ForbiddenSubscription) { throw "Wrong subscription ($sub). Run: az login --use-device-code" }

$token = az account get-access-token --query accessToken -o tsv
$h = @{ Authorization = "Bearer $token" }

Write-Host "Uploading $Zip (clean deploy: wipes old files in wwwroot, restarts)..."
Invoke-WebRequest -UseBasicParsing -Method POST -Uri "$Scm/api/publish?type=zip&clean=true&restart=true" `
  -InFile $Zip -ContentType 'application/zip' -Headers $h -TimeoutSec 900 | Out-Null

Write-Host 'Waiting for deployment...'
do {
  Start-Sleep 10
  $d = Invoke-RestMethod -Uri "$Scm/api/deployments/latest" -Headers $h
  Write-Host "  status=$($d.status) complete=$($d.complete)"
} until ($d.complete)
if ($d.status -ne 4) { throw "Deployment failed (status $($d.status)). See $Scm/api/deployments/latest" }

Write-Host 'Waiting for the app to start (up to 5 min)...'
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep 10
  try { $r = Invoke-WebRequest -UseBasicParsing "$Site/api/health" -TimeoutSec 30; Write-Host $r.Content; break }
  catch { Write-Host "  not ready yet" }
}
