# Wait for Azure resource providers to be Registered
# Usage: ./scripts/wait-azure-providers.ps1 -Providers @('Microsoft.Web','Microsoft.Storage','Microsoft.ServiceBus','Microsoft.Insights') -TimeoutSeconds 600 -PollSeconds 10

param(
  [string[]]$Providers = @('Microsoft.Web','Microsoft.Storage','Microsoft.ServiceBus','Microsoft.Insights','Microsoft.KeyVault'),
  [int]$TimeoutSeconds = 600,
  [int]$PollSeconds = 10
)

Write-Host "Waiting for providers to be Registered..." -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)

# Kick off registration in case it hasn't been called yet
foreach ($p in $Providers) {
  try { az provider register --namespace $p | Out-Null } catch {}
}

$remaining = $Providers

while ($true) {
  $notReady = @()
  foreach ($p in $remaining) {
    try {
      $state = az provider show -n $p --query "registrationState" -o tsv 2>$null
      if ($state -ne 'Registered') {
        $notReady += $p
        Write-Host (" - {0}: {1}" -f $p, ($state | ForEach-Object { $_ }))
      } else {
        Write-Host (" - {0}: Registered" -f $p) -ForegroundColor Green
      }
    } catch {
      $notReady += $p
      Write-Host (" - {0}: Unknown" -f $p)
    }
  }

  if ($notReady.Count -eq 0) {
    Write-Host "All providers are Registered." -ForegroundColor Green
    break
  }

  if ((Get-Date) -ge $deadline) {
    Write-Host "Timeout waiting for providers: $($notReady -join ', ')" -ForegroundColor Red
    exit 1
  }

  Start-Sleep -Seconds $PollSeconds
  $remaining = $notReady
}

