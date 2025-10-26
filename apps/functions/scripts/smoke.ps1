$ErrorActionPreference = 'Stop'

$composeDir = Join-Path -Path $PSScriptRoot -ChildPath '..'
$envFile = Join-Path -Path $composeDir -ChildPath '.env'

if (Test-Path $envFile) {
  Write-Host "Found .env at $envFile 				- using it for docker compose vars."
} else {
  Write-Host 'Reading local.settings.json (fallback because .env not found)...'
  $local = Get-Content -Raw -Path (Join-Path -Path $PSScriptRoot -ChildPath '..\\local.settings.json') | ConvertFrom-Json
  # Export env vars for docker compose variable substitution
  $env:SERVICEBUS_CONNECTION = $local.Values.SERVICEBUS_CONNECTION
  $env:SB_QUEUE_BACKFILL    = $local.Values.SB_QUEUE_BACKFILL
  $env:GRANT_ID             = $local.Values.GRANT_ID
  $env:MONTHS               = $local.Values.MONTHS
  $env:MAX                  = $local.Values.MAX
}

Write-Host 'Enqueuing backfill job via docker compose run smoke...'
Push-Location $composeDir
try {
  docker compose run --rm smoke
} finally {
  Pop-Location
}
