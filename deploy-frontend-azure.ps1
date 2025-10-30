# Azure Frontend Deployment Script for Static Web App

param(
    [string]$SubscriptionId = "d33edd77-3a20-49e3-8dbd-93f0344b235e",
    [string]$ResourceGroup = "rg-email-agent",
    [string]$Location = "eastus2",
    [string]$StaticWebAppName = "swa-email-agent",
    [string]$FunctionsAppUrl = ""
)

# Set subscription
Write-Host "Setting subscription..." -ForegroundColor Cyan
az account set --subscription $SubscriptionId

# Ensure resource group exists
Write-Host "Ensuring resource group exists..." -ForegroundColor Cyan
az group create --name $ResourceGroup --location $Location | Out-Null

# Create Static Web App
Write-Host "Creating Static Web App..." -ForegroundColor Cyan
$swaOutput = az staticwebapp create `
    --name $StaticWebAppName `
    --resource-group $ResourceGroup `
    --location $Location `
    --sku Free `
    --source https://github.com/HomenShum/voice_email_agent `
    --branch main `
    --app-location "/" `
    --output-location "dist" `
    --api-location "apps/functions" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "Static Web App creation failed. Output:`n$swaOutput" -ForegroundColor Red
    exit 1
}

Write-Host "Static Web App created successfully" -ForegroundColor Green

# Get deployment token
Write-Host "Getting deployment token..." -ForegroundColor Cyan
$deployToken = az staticwebapp secrets list `
    --name $StaticWebAppName `
    --resource-group $ResourceGroup `
    --query "properties.apiKey" -o tsv

if (-not $deployToken) {
    Write-Host "Failed to get deployment token" -ForegroundColor Red
    exit 1
}

# Build frontend with production URLs
Write-Host "Building frontend..." -ForegroundColor Cyan
if ($FunctionsAppUrl) {
    $env:VITE_FUNCTIONS_BASE_URL = $FunctionsAppUrl
    $env:VITE_API_BASE = $FunctionsAppUrl
    Write-Host "Using Functions URL: $FunctionsAppUrl" -ForegroundColor Yellow
}

# Build the frontend
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Frontend build failed" -ForegroundColor Red
    exit 1
}

# Deploy to Static Web App
Write-Host "Deploying to Static Web App..." -ForegroundColor Cyan
# Install SWA CLI if not present
try {
    npx swa --version | Out-Null
} catch {
    Write-Host "Installing SWA CLI..." -ForegroundColor Yellow
    npm install -g @azure/static-web-apps-cli
}

# Deploy
$deployOutput = npx swa deploy ./dist `
    --deployment-token $deployToken `
    --app-location "/" `
    --output-location "dist" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "Deployment failed. Output:`n$deployOutput" -ForegroundColor Red
    exit 1
}

# Get Static Web App URL
Write-Host "Getting Static Web App URL..." -ForegroundColor Cyan
$swaUrl = az staticwebapp show `
    --name $StaticWebAppName `
    --resource-group $ResourceGroup `
    --query "defaultHostname" -o tsv

Write-Host ""
Write-Host "=== Frontend Deployment Complete ===" -ForegroundColor Green
Write-Host "Static Web App: $StaticWebAppName" -ForegroundColor Yellow
Write-Host "URL: https://$swaUrl" -ForegroundColor Yellow
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Green
Write-Host "1. Configure CORS on your Function App to allow https://$swaUrl"
Write-Host "2. Test the deployed application"
Write-Host "3. Set up custom domain (optional)"
