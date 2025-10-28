# Configure Azure Functions App Settings

param(
    [string]$FuncAppName = "func-email-agent-1426",
    [string]$ResourceGroup = "rg-email-agent",
    [string]$SbNamespace = "sb-email-agent-3512",
    [string]$QueueName = "nylas-backfill"
)

Write-Host "Configuring app settings for: $FuncAppName" -ForegroundColor Cyan

# Load .env file
$envFile = ".env"
if (-not (Test-Path $envFile)) {
    Write-Host ".env file not found" -ForegroundColor Red
    exit 1
}

$envVars = @{}
Get-Content $envFile | ForEach-Object {
    if ($_ -match "^([^=]+)=(.*)$") {
        $envVars[$matches[1]] = $matches[2]
    }
}

$nylasApiKey = $envVars["NYLAS_API_KEY"]
$nylasGrantId = $envVars["NYLAS_GRANT_ID"]
$openaiApiKey = $envVars["OPENAI_API_KEY"]
$pineconeApiKey = $envVars["PINECONE_API_KEY"]
$pineconeIndexHost = $envVars["PINECONE_INDEX_HOST"]
$embedModel = if ($envVars["OPENAI_EMBED_MODEL"]) { $envVars["OPENAI_EMBED_MODEL"] } else { "text-embedding-3-small" }
$textModel = if ($envVars["OPENAI_TEXT_MODEL"]) { $envVars["OPENAI_TEXT_MODEL"] } else { "gpt-5-mini" }
$pineconeIndexName = if ($envVars["PINECONE_INDEX_NAME"]) { $envVars["PINECONE_INDEX_NAME"] } else { "emails" }
$nylasBase = if ($envVars["NYLAS_BASE"]) { $envVars["NYLAS_BASE"] } else { "https://api.us.nylas.com/v3" }
$nylasWebhookSecret = if ($envVars["NYLAS_WEBHOOK_SECRET"]) { $envVars["NYLAS_WEBHOOK_SECRET"] } else { "dev" }
$deltaDefaultMonths = if ($envVars["DELTA_DEFAULT_MONTHS"]) { $envVars["DELTA_DEFAULT_MONTHS"] } else { "1" }
$deltaMax = if ($envVars["DELTA_MAX"]) { $envVars["DELTA_MAX"] } else { "100000" }

# Allow .env to override namespace/queue if provided
if ($envVars["SERVICEBUS_NAMESPACE"]) { $SbNamespace = $envVars["SERVICEBUS_NAMESPACE"] }
if ($envVars["SB_QUEUE_BACKFILL"]) { $QueueName = $envVars["SB_QUEUE_BACKFILL"] }

Write-Host "Loaded secrets from .env" -ForegroundColor Green

# Get Service Bus connection string
Write-Host "Getting Service Bus connection string..." -ForegroundColor Yellow
$sbConnStr = az servicebus namespace authorization-rule keys list `
  --name RootManageSharedAccessKey `
  --namespace-name $SbNamespace `
  --resource-group $ResourceGroup `
  --query primaryConnectionString -o tsv

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to get Service Bus connection string" -ForegroundColor Red
    exit 1
}
Write-Host "OK Service Bus connection string retrieved" -ForegroundColor Green

# Skip App Insights connection string retrieval (optional)
$appInsightsConnStr = ""

# Key Vault integration (store secrets in KV, reference from app settings)
Write-Host "Ensuring Key Vault and managed identity..." -ForegroundColor Yellow
$kvName = if ($envVars["KEYVAULT_NAME"]) { $envVars["KEYVAULT_NAME"] } else { "kv-email-agent-$(Get-Random -Minimum 1000 -Maximum 9999)" }
$funcLocation = az functionapp show --name $FuncAppName --resource-group $ResourceGroup --query location -o tsv

# Assign system-assigned identity to the Function App
$principalId = az webapp identity assign --name $FuncAppName --resource-group $ResourceGroup --query principalId -o tsv
if (-not $principalId) {
  Write-Host "Failed to assign managed identity to Function App" -ForegroundColor Red
  exit 1
}

# Create or get Key Vault
az keyvault show --name $kvName --resource-group $ResourceGroup 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Creating Key Vault $kvName in $funcLocation..." -ForegroundColor Cyan
  az keyvault create --name $kvName --resource-group $ResourceGroup --location $funcLocation | Out-Null
}

# Grant Function App identity permissions to read secrets
Write-Host "Granting Key Vault secret permissions to managed identity..." -ForegroundColor Cyan
az keyvault set-policy --name $kvName --object-id $principalId --secret-permissions get list | Out-Null

# Upsert secrets to Key Vault if values provided (use hyphenated names per KV rules)
Write-Host "Storing secrets in Key Vault..." -ForegroundColor Yellow
if ($sbConnStr) { az keyvault secret set --vault-name $kvName --name "SERVICEBUS-CONNECTION" --value $sbConnStr | Out-Null }
if ($nylasApiKey) { az keyvault secret set --vault-name $kvName --name "NYLAS-API-KEY" --value $nylasApiKey | Out-Null }
if ($nylasGrantId) { az keyvault secret set --vault-name $kvName --name "NYLAS-GRANT-ID" --value $nylasGrantId | Out-Null }
if ($openaiApiKey) { az keyvault secret set --vault-name $kvName --name "OPENAI-API-KEY" --value $openaiApiKey | Out-Null }
if ($pineconeApiKey) { az keyvault secret set --vault-name $kvName --name "PINECONE-API-KEY" --value $pineconeApiKey | Out-Null }
if ($pineconeIndexHost) { az keyvault secret set --vault-name $kvName --name "PINECONE-INDEX-HOST" --value $pineconeIndexHost | Out-Null }
if ($nylasWebhookSecret) { az keyvault secret set --vault-name $kvName --name "NYLAS-WEBHOOK-SECRET" --value $nylasWebhookSecret | Out-Null }

# Configure app settings to reference Key Vault for secrets
Write-Host "Configuring app settings (Key Vault references + plain config)..." -ForegroundColor Yellow
# Build a dictionary and write to a temp JSON file to avoid shell quoting issues
$settingsMap = @{}

# Secret references
if ($sbConnStr) { $settingsMap["SERVICEBUS_CONNECTION"] = "@Microsoft.KeyVault(VaultName=$kvName;SecretName=SERVICEBUS-CONNECTION)" }
if ($nylasApiKey) { $settingsMap["NYLAS_API_KEY"] = "@Microsoft.KeyVault(VaultName=$kvName;SecretName=NYLAS-API-KEY)" }
if ($nylasGrantId) { $settingsMap["NYLAS_GRANT_ID"] = "@Microsoft.KeyVault(VaultName=$kvName;SecretName=NYLAS-GRANT-ID)" }
if ($openaiApiKey) { $settingsMap["OPENAI_API_KEY"] = "@Microsoft.KeyVault(VaultName=$kvName;SecretName=OPENAI-API-KEY)" }
if ($pineconeApiKey) { $settingsMap["PINECONE_API_KEY"] = "@Microsoft.KeyVault(VaultName=$kvName;SecretName=PINECONE-API-KEY)" }
if ($pineconeIndexHost) { $settingsMap["PINECONE_INDEX_HOST"] = "@Microsoft.KeyVault(VaultName=$kvName;SecretName=PINECONE-INDEX-HOST)" }
if ($nylasWebhookSecret) { $settingsMap["NYLAS_WEBHOOK_SECRET"] = "@Microsoft.KeyVault(VaultName=$kvName;SecretName=NYLAS-WEBHOOK-SECRET)" }

# Non-secret config values
$settingsMap["SB_QUEUE_BACKFILL"] = $QueueName
$settingsMap["NYLAS_BASE"] = $nylasBase
$settingsMap["OPENAI_EMBED_MODEL"] = $embedModel
$settingsMap["OPENAI_TEXT_MODEL"] = $textModel
$settingsMap["PINECONE_INDEX_NAME"] = $pineconeIndexName
$settingsMap["DELTA_DEFAULT_MONTHS"] = $deltaDefaultMonths
$settingsMap["DELTA_MAX"] = $deltaMax
# Optional: install devDependencies during remote build; Flex Consumption performs Oryx build automatically.
$settingsMap["NPM_CONFIG_PRODUCTION"] = "false"
if ($appInsightsConnStr) { $settingsMap["APPLICATIONINSIGHTS_CONNECTION_STRING"] = $appInsightsConnStr }

$tmpFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "appsettings_$($FuncAppName).json")
$settingsMap | ConvertTo-Json -Depth 5 | Out-File -FilePath $tmpFile -Encoding utf8

$settingsArg = "@" + $tmpFile
az webapp config appsettings set `
  --name $FuncAppName `
  --resource-group $ResourceGroup `
  --settings $settingsArg

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to configure app settings" -ForegroundColor Red
    exit 1
}

# Remove unsupported app settings for Flex Consumption if present
try {
  az functionapp config appsettings delete `
    --name $FuncAppName `
    --resource-group $ResourceGroup `
    --setting-names SCM_DO_BUILD_DURING_DEPLOYMENT ENABLE_ORYX_BUILD | Out-Null
} catch {}

Write-Host "App settings configured" -ForegroundColor Green
# Cleanup temp file
Remove-Item -Path $tmpFile -ErrorAction SilentlyContinue

