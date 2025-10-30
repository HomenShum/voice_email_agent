# Script to help set up GitHub secrets for Azure deployment
# Run this script to get all the values you need for GitHub Actions

Write-Host "=== GitHub Secrets Setup Helper ===" -ForegroundColor Cyan
Write-Host "This script will help you get all the values needed for GitHub secrets." -ForegroundColor Yellow
Write-Host ""

# Check if Azure CLI is logged in
try {
    $account = az account show --query name -o tsv
    Write-Host "✓ Logged in to Azure as: $account" -ForegroundColor Green
} catch {
    Write-Host "❌ Not logged in to Azure. Please run 'az login' first." -ForegroundColor Red
    exit 1
}

Write-Host "`n=== Step 1: Azure AD App Registration ===" -ForegroundColor Cyan
Write-Host "Creating Azure AD app for GitHub Actions..." -ForegroundColor Yellow

try {
    $spOutput = az ad sp create-for-rbac --name "github-actions-email-agent" --role contributor --scopes "/subscriptions/d33edd77-3a20-49e3-8dbd-93f0344b235e" --json-auth
    $spData = $spOutput | ConvertFrom-Json
    
    Write-Host "✓ Azure AD app created" -ForegroundColor Green
    Write-Host ""
    Write-Host "Add these secrets to GitHub:" -ForegroundColor Yellow
    Write-Host "AZURE_CLIENT_ID: $($spData.clientId)" -ForegroundColor White
    Write-Host "AZURE_TENANT_ID: $($spData.tenantId)" -ForegroundColor Yellow
    Write-Host "AZURE_SUBSCRIPTION_ID: d33edd77-3a20-49e3-8dbd-93f0344b235e" -ForegroundColor Yellow
    Write-Host "AZURE_CLIENT_SECRET: $($spData.clientSecret)" -ForegroundColor Yellow
    
} catch {
    Write-Host "❌ Failed to create Azure AD app. You may need permissions." -ForegroundColor Red
    Write-Host "Please create manually in Azure Portal or check your permissions." -ForegroundColor Red
}

Write-Host "`n=== Step 2: Get Resource Names ===" -ForegroundColor Cyan

# Try to get actual resource names from recent deployment
$rgName = "rg-email-agent"
$functionAppName = "func-email-agent"
$staticWebAppName = "swa-email-agent"

# Get Function App name
try {
    $functionApps = az functionapp list --resource-group $rgName --query "[].name" -o tsv
    if ($functionApps) {
        $functionAppName = $functionApps.Split("`n")[0]
        Write-Host "✓ Found Function App: $functionAppName" -ForegroundColor Green
    }
} catch {
    Write-Host "⚠️ Could not auto-detect Function App name. Using default." -ForegroundColor Yellow
}

# Get Static Web App name
try {
    $staticWebApps = az staticwebapp list --resource-group $rgName --query "[].name" -o tsv
    if ($staticWebApps) {
        $staticWebAppName = $staticWebApps.Split("`n")[0]
        Write-Host "✓ Found Static Web App: $staticWebAppName" -ForegroundColor Green
    }
} catch {
    Write-Host "⚠️ Could not auto-detect Static Web App name. Using default." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Add these resource name secrets to GitHub:" -ForegroundColor Yellow
Write-Host "AZURE_FUNCTION_APP_NAME: $functionAppName" -ForegroundColor White
Write-Host "AZURE_STATIC_WEB_APP_NAME: $staticWebAppName" -ForegroundColor White
Write-Host "AZURE_FUNCTION_APP_URL: https://$functionAppName.azurewebsites.net" -ForegroundColor White

Write-Host "`n=== Step 3: Get Deployment Credentials ===" -ForegroundColor Cyan

# Get Function App publish profile
try {
    Write-Host "Getting Function App publish profile..." -ForegroundColor Yellow
    $publishProfile = az functionapp deployment list-publishing-profiles --name $functionAppName --resource-group $rgName --xml
    Write-Host "✓ Function App publish profile retrieved" -ForegroundColor Green
    Write-Host ""
    Write-Host "Add this secret to GitHub:" -ForegroundColor Yellow
    Write-Host "AZURE_FUNCTIONAPP_PUBLISH_PROFILE: (copy the entire XML output below)" -ForegroundColor White
    Write-Host $publishProfile
} catch {
    Write-Host "❌ Failed to get Function App publish profile" -ForegroundColor Red
}

# Get Static Web App deployment token
try {
    Write-Host "Getting Static Web App deployment token..." -ForegroundColor Yellow
    $deployToken = az staticwebapp secrets list --name $staticWebAppName --resource-group $rgName --query "properties.apiKey" -o tsv
    Write-Host "✓ Static Web App deployment token retrieved" -ForegroundColor Green
    Write-Host ""
    Write-Host "Add this secret to GitHub:" -ForegroundColor Yellow
    Write-Host "AZURE_STATIC_WEB_APPS_API_TOKEN: $deployToken" -ForegroundColor White
} catch {
    Write-Host "❌ Failed to get Static Web App deployment token" -ForegroundColor Red
}

Write-Host "`n=== Setup Complete ===" -ForegroundColor Green
Write-Host "Go to your GitHub repository → Settings → Secrets and variables → Actions" -ForegroundColor Yellow
Write-Host "Add all the secrets listed above, then push to main branch to trigger deployment." -ForegroundColor Yellow
Write-Host ""
Write-Host "For manual deployment, run:" -ForegroundColor Cyan
Write-Host "cd apps/functions; func azure functionapp publish $functionAppName --build remote" -ForegroundColor White
Write-Host "cd ../..; npm run build; npx swa deploy ./dist --deployment-token <YOUR_TOKEN>" -ForegroundColor White
