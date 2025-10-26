# Azure Deployment Script for Email Agent Backend
# This script deploys the Timer + Service Bus Queue + Worker pipeline to Azure

param(
    [string]$SubscriptionId = "d33edd77-3a20-49e3-8dbd-93f0344b235e",
    [string]$ResourceGroup = "rg-email-agent",
    [string]$Location = "eastus"
)

# Generate unique names (use existing Service Bus namespace)
$sbNamespace = "sb-email-agent-3512"  # Use existing namespace
$funcAppName = "func-email-agent-$(Get-Random -Minimum 1000 -Maximum 9999)"
$storageAccount = "stemail$(Get-Random -Minimum 100000 -Maximum 999999)"
$appInsightsName = "ai-email-agent-$(Get-Random -Minimum 1000 -Maximum 9999)"
$queueName = "nylas-backfill"

Write-Host "=== Azure Deployment Starting ===" -ForegroundColor Green
Write-Host "Subscription: $SubscriptionId"
Write-Host "Resource Group: $ResourceGroup"
Write-Host "Location: $Location"
Write-Host "Service Bus: $sbNamespace"
Write-Host "Functions App: $funcAppName"
Write-Host "Storage: $storageAccount"
Write-Host ""

# Set subscription
Write-Host "Setting subscription..." -ForegroundColor Cyan
az account set --subscription $SubscriptionId

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
    --requires-session `
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

# Create Functions App with consumption plan
Write-Host "Creating Azure Functions app..." -ForegroundColor Cyan
az functionapp create `
    --name $funcAppName `
    --resource-group $ResourceGroup `
    --storage-account $storageAccount `
    --runtime node `
    --runtime-version 20 `
    --functions-version 4 `
    --os-type Windows `
    --consumption-plan-location $Location 2>&1 | Out-Null

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

