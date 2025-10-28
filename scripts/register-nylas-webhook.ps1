param(
  [string]$FuncAppName,
  [string]$ResourceGroup,
  [string]$KeyVaultName = ""
)

if (-not $FuncAppName -or -not $ResourceGroup) {
  Write-Error "Usage: ./scripts/register-nylas-webhook.ps1 -FuncAppName <name> -ResourceGroup <rg> [-KeyVaultName <kv>]"
  exit 1
}

# Load .env for Nylas config
$envFile = ".env"
if (-not (Test-Path $envFile)) { Write-Error ".env not found"; exit 1 }
$envVars = @{}
Get-Content $envFile | ForEach-Object { if ($_ -match "^([^=]+)=(.*)$") { $envVars[$matches[1]] = $matches[2] } }

$nylasApiKey = if ($envVars["NYLAS_API_KEY"]) { $envVars["NYLAS_API_KEY"].Trim() } else { "" }
$nylasBase = if ($envVars["NYLAS_BASE"]) { $envVars["NYLAS_BASE"].Trim() } else { "https://api.us.nylas.com/v3" }
$nylasTriggers = if ($envVars["NYLAS_WEBHOOK_TRIGGERS"]) { $envVars["NYLAS_WEBHOOK_TRIGGERS"].Trim() } else { "message.created,message.updated" }
$notifyEmails = if ($envVars["NYLAS_WEBHOOK_NOTIFY_EMAILS"]) { $envVars["NYLAS_WEBHOOK_NOTIFY_EMAILS"].Trim() } else { "" }
if (-not $nylasApiKey) { Write-Error "NYLAS_API_KEY missing from .env"; exit 1 }

# Resolve webhook URL
$funcHost = az functionapp show --name $FuncAppName --resource-group $ResourceGroup --query properties.defaultHostName -o tsv
if (-not $funcHost) { Write-Error "Failed to resolve Function App host"; exit 1 }
$webhookUrl = "https://$funcHost/api/webhooks/nylas"

# Create webhook via Nylas v3 API
$triggerArray = $nylasTriggers.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
$payload = @{ webhook_url = $webhookUrl; trigger_types = $triggerArray; description = "Azure Functions" }
if ($notifyEmails) { $payload.notification_email_addresses = $notifyEmails.Split(',') | ForEach-Object { $_.Trim() } }

$headers = @{ Authorization = "Bearer $nylasApiKey"; "Content-Type" = "application/json" }
$createUri = if ($nylasBase.TrimEnd('/')) { ($nylasBase.TrimEnd('/') + "/webhooks/") } else { "https://api.us.nylas.com/v3/webhooks/" }
Write-Host "Registering Nylas webhook at $webhookUrl with triggers: $($triggerArray -join ', ')" -ForegroundColor Cyan

try {
  $resp = Invoke-RestMethod -Method Post -Uri $createUri -Headers $headers -Body ($payload | ConvertTo-Json -Depth 5)
} catch {
  Write-Warning "Create webhook failed, trying to list existing... $_"
}

# If create failed or returned no secret, try to find existing webhook
$secret = $null
if ($resp) {
  if ($resp.data -and $resp.data.webhook_secret) { $secret = $resp.data.webhook_secret }
  elseif ($resp.webhook_secret) { $secret = $resp.webhook_secret }
  elseif ($resp.secret) { $secret = $resp.secret }
}

if (-not $secret) {
  $listUri = ($nylasBase.TrimEnd('/') + "/webhooks/")
  try {
    $list = Invoke-RestMethod -Method Get -Uri $listUri -Headers $headers
    # Find our endpoint
    $existing = $null
    if ($list -and $list.data) { $existing = $list.data | Where-Object { $_.webhook_url -eq $webhookUrl } | Select-Object -First 1 }
    if ($existing) {
      # Fetch details which may include secret depending on API behavior
      $getUri = ($nylasBase.TrimEnd('/') + "/webhooks/" + $existing.id)
      $details = Invoke-RestMethod -Method Get -Uri $getUri -Headers $headers
      if ($details) {
        if ($details.data -and $details.data.webhook_secret) { $secret = $details.data.webhook_secret }
        elseif ($details.webhook_secret) { $secret = $details.webhook_secret }
        elseif ($details.secret) { $secret = $details.secret }
      }
    }
  } catch {
    Write-Warning "Failed to retrieve existing webhook details. $_"
  }
}

if (-not $secret) {
  Write-Warning "Webhook registered but no secret returned. You may need to retrieve it from the Nylas Dashboard."
  exit 0
}

# Resolve Key Vault name: prefer parameter, then .env KEYVAULT_NAME, else pick newest kv-* in RG
if (-not $KeyVaultName) { if ($envVars["KEYVAULT_NAME"]) { $KeyVaultName = $envVars["KEYVAULT_NAME"].Trim() } }
if (-not $KeyVaultName) {
  $kv = az keyvault list -g $ResourceGroup --query "sort_by([?starts_with(name, 'kv-')], &systemData.createdAt)[-1].name" -o tsv
  if ($kv) { $KeyVaultName = $kv }
}
if (-not $KeyVaultName) { Write-Warning "Could not resolve Key Vault name; skipping storing NYLAS webhook secret."; exit 0 }

Write-Host "Storing NYLAS-WEBHOOK-SECRET in Key Vault $KeyVaultName" -ForegroundColor Yellow
az keyvault secret set --vault-name $KeyVaultName --name "NYLAS-WEBHOOK-SECRET" --value $secret | Out-Null

Write-Host "Webhook registration complete. Secret stored in KV and Function App will resolve it via Key Vault reference." -ForegroundColor Green

