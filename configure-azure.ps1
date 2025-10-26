# Configure Azure Functions App Settings
# This script sets all required environment variables for the Functions app

param(
    [string]$FuncAppName = "func-email-agent-5231",
    [string]$ResourceGroup = "rg-email-agent",
    [string]$ServiceBusConnStr = ""  # Provide via parameter or retrieve from Azure
)

Write-Host "=== Configuring Azure Functions App ===" -ForegroundColor Green
Write-Host "Function App: $FuncAppName"
Write-Host "Resource Group: $ResourceGroup"
Write-Host ""

# Read from .env file
$envVars = @{}
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match "^([^=]+)=(.*)$") {
            $envVars[$matches[1]] = $matches[2]
        }
    }
}

# Prepare app settings
$settings = @(
    "SERVICEBUS_CONNECTION=$ServiceBusConnStr",
    "SB_QUEUE_BACKFILL=nylas-backfill",
    "NYLAS_API_KEY=$($envVars['NYLAS_API_KEY'])",
    "NYLAS_GRANT_ID=$($envVars['NYLAS_GRANT_ID'])",
    "NYLAS_BASE=https://api.us.nylas.com/v3",
    "OPENAI_API_KEY=$($envVars['OPENAI_API_KEY'])",
    "OPENAI_EMBED_MODEL=text-embedding-3-small",
    "OPENAI_TEXT_MODEL=gpt-5-mini",
    "PINECONE_API_KEY=$($envVars['PINECONE_API_KEY'])",
    "PINECONE_INDEX_NAME=emails",
    "NYLAS_WEBHOOK_SECRET=your-webhook-secret-here",
    "APPLICATIONINSIGHTS_CONNECTION_STRING=",
    "NYLAS_MOCK=0",
    "SMOKE_TEST=0",
    "PINECONE_DISABLE=0",
    "MONTHS=1",
    "MAX=200"
)

Write-Host "Configuring app settings..." -ForegroundColor Cyan
az functionapp config appsettings set `
    --name $FuncAppName `
    --resource-group $ResourceGroup `
    --settings $settings

Write-Host ""
Write-Host "=== Configuration Complete ===" -ForegroundColor Green
Write-Host "Next: Deploy code with 'func azure functionapp publish $FuncAppName --build remote'"
Write-Host ""
Write-Host "Important: Update NYLAS_WEBHOOK_SECRET in Azure Portal after registering webhook"

