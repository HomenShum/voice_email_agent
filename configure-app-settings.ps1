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
    Write-Host "✗ .env file not found" -ForegroundColor Red
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

Write-Host "Loaded secrets from .env" -ForegroundColor Green

# Get Service Bus connection string
Write-Host "Getting Service Bus connection string..." -ForegroundColor Yellow
$sbConnStr = az servicebus namespace authorization-rule keys list `
  --name RootManageSharedAccessKey `
  --namespace-name $SbNamespace `
  --resource-group $ResourceGroup `
  --query primaryConnectionString -o tsv

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Failed to get Service Bus connection string" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Service Bus connection string retrieved" -ForegroundColor Green

# Get App Insights connection string
Write-Host "Getting App Insights connection string..." -ForegroundColor Yellow
$appInsightsName = az resource list --resource-group $ResourceGroup --resource-type "microsoft.insights/components" --query "[0].name" -o tsv 2>$null

if ($appInsightsName -and $appInsightsName.Length -gt 0) {
    $appInsightsConnStr = az monitor app-insights component show `
      --app $appInsightsName `
      --resource-group $ResourceGroup `
      --query connectionString -o tsv 2>$null
    Write-Host "✓ App Insights connection string retrieved" -ForegroundColor Green
}
else {
    Write-Host "⚠ App Insights not found, skipping" -ForegroundColor Yellow
    $appInsightsConnStr = ""
}

# Configure app settings
Write-Host "Configuring app settings..." -ForegroundColor Yellow

$settings = @(
    "SERVICEBUS_CONNECTION=$sbConnStr",
    "SB_QUEUE_BACKFILL=$QueueName",
    "NYLAS_API_KEY=$nylasApiKey",
    "NYLAS_GRANT_ID=$nylasGrantId",
    "NYLAS_BASE=https://api.us.nylas.com/v3",
    "OPENAI_API_KEY=$openaiApiKey",
    "OPENAI_EMBED_MODEL=text-embedding-3-small",
    "OPENAI_TEXT_MODEL=gpt-5-mini",
    "PINECONE_API_KEY=$pineconeApiKey",
    "PINECONE_INDEX_NAME=emails",
    "PINECONE_INDEX_HOST=$pineconeIndexHost",
    "NYLAS_WEBHOOK_SECRET=dev",
    "DELTA_DEFAULT_MONTHS=1",
    "DELTA_MAX=100000"
)

if ($appInsightsConnStr) {
    $settings += "APPLICATIONINSIGHTS_CONNECTION_STRING=$appInsightsConnStr"
}

az functionapp config appsettings set `
  --name $FuncAppName `
  --resource-group $ResourceGroup `
  --settings $settings

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Failed to configure app settings" -ForegroundColor Red
    exit 1
}
Write-Host "✓ App settings configured" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "✓ App settings configured successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next step: Deploy Functions code"
Write-Host "cd apps/functions && func azure functionapp publish $FuncAppName --build remote"

