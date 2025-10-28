# Azure Deployment Script for Email Agent Backend
# This script deploys the Timer + Service Bus Queue + Worker pipeline to Azure

param(
    [string]$SubscriptionId = "d33edd77-3a20-49e3-8dbd-93f0344b235e",
    [string]$ResourceGroup = "rg-email-agent",
    [string]$Location = "eastus"
)

# Generate names; allow .env overrides for sb namespace and queue
$envFile = Join-Path (Get-Location) ".env"
$envVars = @{}
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object { if ($_ -match "^([^=]+)=(.*)$") { $envVars[$matches[1]] = $matches[2] } }
}
$sbNamespace = if ($envVars.ContainsKey("SERVICEBUS_NAMESPACE") -and $envVars["SERVICEBUS_NAMESPACE"]) { $envVars["SERVICEBUS_NAMESPACE"] } else { "sb-email-agent-$(Get-Random -Minimum 1000 -Maximum 9999)" }
$funcAppName = if ($envVars.ContainsKey("FUNCTION_APP_NAME") -and $envVars["FUNCTION_APP_NAME"]) { $envVars["FUNCTION_APP_NAME"] } else { "func-email-agent-$(Get-Random -Minimum 1000 -Maximum 9999)" }
$storageAccount = if ($envVars.ContainsKey("STORAGE_ACCOUNT_NAME") -and $envVars["STORAGE_ACCOUNT_NAME"]) { $envVars["STORAGE_ACCOUNT_NAME"] } else { "stemail$(Get-Random -Minimum 100000 -Maximum 999999)" }
$appInsightsName = "ai-email-agent-$(Get-Random -Minimum 1000 -Maximum 9999)"
$queueName = if ($envVars.ContainsKey("SB_QUEUE_BACKFILL") -and $envVars["SB_QUEUE_BACKFILL"]) { $envVars["SB_QUEUE_BACKFILL"] } else { "nylas-backfill" }
$planName = "funcplan-email-agent-$(Get-Random -Minimum 1000 -Maximum 9999)"


Write-Host "=== Azure Deployment Starting ===" -ForegroundColor Green
Write-Host "Subscription: $SubscriptionId"
Write-Host "Resource Group: $ResourceGroup"
Write-Host "Location: $Location"
Write-Host "Service Bus: $sbNamespace"
Write-Host "Functions App: $funcAppName"
Write-Host "Storage: $storageAccount"
# Set subscription
Write-Host "Setting subscription..." -ForegroundColor Cyan
az account set --subscription $SubscriptionId

# Ensure required providers are registered before creating resources
Write-Host "Ensuring providers registered..." -ForegroundColor Cyan
./scripts/wait-azure-providers.ps1

Write-Host ""

# Create resource group
Write-Host "Creating resource group..." -ForegroundColor Cyan
az group create --name $ResourceGroup --location $Location

# Create storage account
Write-Host "Creating storage account..." -ForegroundColor Cyan
az storage account create `
    --name $storageAccount `
    --resource-group $ResourceGroup `
    --location $Location `
    --sku Standard_LRS 2>&1 | Out-Null

# Get storage connection string
Write-Host "Getting storage connection string..." -ForegroundColor Cyan
$storageConnStr = az storage account show-connection-string `
    --name $storageAccount `
    --resource-group $ResourceGroup `
    --query connectionString -o tsv 2>&1

if (-not $storageConnStr -or $storageConnStr -like "*ERROR*") {
    Write-Host "Warning: Could not get storage connection string, using default" -ForegroundColor Yellow
    $storageConnStr = "DefaultEndpointsProtocol=https;AccountName=$storageAccount;AccountKey=placeholder;EndpointSuffix=core.windows.net"
}

# Create Service Bus namespace
Write-Host "Creating Service Bus namespace..." -ForegroundColor Cyan
az servicebus namespace create `
    --name $sbNamespace `
    --resource-group $ResourceGroup `
    --location $Location `
    --sku Standard

# Create queue with sessions
Write-Host "Creating queue with sessions enabled..." -ForegroundColor Cyan
az servicebus queue create `
    --name $queueName `
    --namespace-name $sbNamespace `
    --resource-group $ResourceGroup `
    --enable-session true `
    --max-delivery-count 10 `
    --default-message-time-to-live PT1H 2>&1 | Out-Null

# Get Service Bus connection string
Write-Host "Getting Service Bus connection string..." -ForegroundColor Cyan
$sbConnStr = az servicebus namespace authorization-rule keys list `
    --name RootManageSharedAccessKey `
    --namespace-name $sbNamespace `
    --resource-group $ResourceGroup `
    --query primaryConnectionString -o tsv

# Create Application Insights (optional - skip if provider registration fails)
Write-Host "Creating Application Insights..." -ForegroundColor Cyan
$appInsightsConnStr = ""
# Skip App Insights for now due to provider registration issues
# az monitor app-insights component create ... (requires provider registration)
# Create Function App (Flex Consumption plan)
Write-Host "Creating Azure Functions app (Flex Consumption)..." -ForegroundColor Cyan
# Optional: validate region supports Flex Consumption
try {
  $flexRegions = az functionapp list-flexconsumption-locations --query "[].name" -o tsv 2>$null
  if ($flexRegions -and ($flexRegions -notcontains $Location)) {
    Write-Host "Warning: $Location may not support Flex Consumption. Supported regions: $flexRegions" -ForegroundColor Yellow
  }
} catch {}

$createOutput = az functionapp create `
    --name $funcAppName `
    --resource-group $ResourceGroup `
    --storage-account $storageAccount `
    --runtime node `
    --runtime-version 20 `
    --functions-version 4 `
    --flexconsumption-location $Location
if ($LASTEXITCODE -ne 0) {
    Write-Error "Function App creation failed. Output:`n$createOutput"
    exit 1
}

# Wait until the Function App resource exists
Write-Host "Waiting for Function App resource to be available..." -ForegroundColor Cyan
az resource wait `
    --exists `
    --resource-group $ResourceGroup `
    --resource-type "Microsoft.Web/sites" `
    --name $funcAppName

# Sync app settings from .env to Azure Function App (includes Key Vault integration)
Write-Host "Syncing app settings from .env..." -ForegroundColor Cyan
./configure-app-settings.ps1 -FuncAppName $funcAppName -ResourceGroup $ResourceGroup -SbNamespace $sbNamespace -QueueName $queueName

Write-Host ""
Write-Host "=== Deployment Complete ===" -ForegroundColor Green
Write-Host "Resource Group: $ResourceGroup" -ForegroundColor Yellow
Write-Host "Service Bus: $sbNamespace" -ForegroundColor Yellow
Write-Host "Functions App: $funcAppName" -ForegroundColor Yellow
Write-Host "Storage Account: $storageAccount" -ForegroundColor Yellow
Write-Host ""
Write-Host "Connection Strings:" -ForegroundColor Cyan
Write-Host "Service Bus: $sbConnStr"
Write-Host "App Insights: $appInsightsConnStr"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Green
Write-Host "1. Configure app settings with your API keys"
Write-Host "2. Deploy code: func azure functionapp publish $funcAppName --build remote"
Write-Host "3. Register Nylas webhook URL"

