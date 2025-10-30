# Test script to verify Azure deployment is working
param(
    [string]$ResourceGroup = "rg-email-agent",
    [string]$FunctionAppName = "",
    [string]$StaticWebAppName = "swa-email-agent"
)

Write-Host "=== Azure Deployment Test ===" -ForegroundColor Cyan

# Auto-discover Function App name if not provided
if (-not $FunctionAppName) {
    Write-Host "Discovering Function App name..." -ForegroundColor Yellow
    $functionApps = az functionapp list --resource-group $ResourceGroup --query "[].name" -o tsv
    if ($functionApps) {
        $FunctionAppName = $functionApps.Split("`n")[0]
        Write-Host "Found Function App: $FunctionAppName" -ForegroundColor Green
    } else {
        Write-Host "No Function Apps found in resource group $ResourceGroup" -ForegroundColor Red
        exit 1
    }
}

# Get Function App URL
Write-Host "Getting Function App URL..." -ForegroundColor Yellow
$funcUrl = az functionapp show --name $FunctionAppName --resource-group $ResourceGroup --query defaultHostName -o tsv
if (-not $funcUrl) {
    Write-Host "Failed to get Function App URL" -ForegroundColor Red
    exit 1
}

Write-Host "Function App URL: https://$funcUrl" -ForegroundColor Green

# Test Functions endpoints
Write-Host "`n=== Testing Azure Functions ===" -ForegroundColor Cyan

$baseUrl = "https://$funcUrl"

# Test 1: Index Stats
Write-Host "Testing /api/index/stats..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/index/stats?includePersisted=1" -Method GET
    Write-Host "✓ Index Stats endpoint working" -ForegroundColor Green
    Write-Host "  Response: $($response | ConvertTo-Json -Compress)" -ForegroundColor White
} catch {
    Write-Host "❌ Index Stats failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: Search endpoint (will need valid grant ID)
Write-Host "`nTesting /api/search..." -ForegroundColor Yellow
try {
    $searchBody = @{
        grantId = "22dd5c25-157e-4377-af23-e06602fdfcec"
        query = "test"
        topK = 5
    } | ConvertTo-Json -Depth 3
    
    $response = Invoke-RestMethod -Uri "$baseUrl/api/search" -Method POST -Body $searchBody -ContentType "application/json"
    Write-Host "✓ Search endpoint working" -ForegroundColor Green
    Write-Host "  Found $($response.matches.Count) results" -ForegroundColor White
} catch {
    Write-Host "⚠️ Search endpoint test failed (may need valid grant ID): $($_.Exception.Message)" -ForegroundColor Yellow
}

# Test 3: Jobs List
Write-Host "`nTesting /api/user/jobs..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/user/jobs?grantId=22dd5c25-157e-4377-af23-e06602fdfcec" -Method GET
    Write-Host "✓ Jobs endpoint working" -ForegroundColor Green
    Write-Host "  Jobs count: $($response.jobs.Count)" -ForegroundColor White
} catch {
    Write-Host "⚠️ Jobs endpoint test failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Test Static Web App
Write-Host "`n=== Testing Static Web App ===" -ForegroundColor Cyan

try {
    $swaUrl = az staticwebapp show --name $StaticWebAppName --resource-group $ResourceGroup --query "defaultHostname" -o tsv
    if ($swaUrl) {
        Write-Host "Static Web App URL: https://$swaUrl" -ForegroundColor Green
        
        # Test if the site is accessible
        $response = Invoke-WebRequest -Uri "https://$swaUrl" -Method GET -TimeoutSec 30
        if ($response.StatusCode -eq 200) {
            Write-Host "✓ Static Web App is accessible" -ForegroundColor Green
        } else {
            Write-Host "❌ Static Web App returned status: $($response.StatusCode)" -ForegroundColor Red
        }
    } else {
        Write-Host "❌ Could not get Static Web App URL" -ForegroundColor Red
    }
} catch {
    Write-Host "⚠️ Static Web App test failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Test Service Bus
Write-Host "`n=== Testing Service Bus ===" -ForegroundColor Cyan

try {
    $sbNamespace = az servicebus namespace list --resource-group $ResourceGroup --query "[].name" -o tsv
    if ($sbNamespace) {
        $sbNamespace = $sbNamespace.Split("`n")[0]
        Write-Host "Service Bus Namespace: $sbNamespace" -ForegroundColor Green
        
        # Check queue
        $queueInfo = az servicebus queue show --name "nylas-backfill" --namespace-name $sbNamespace --resource-group $ResourceGroup --query "countDetails" -o tsv
        Write-Host "✓ Service Bus queue accessible" -ForegroundColor Green
    } else {
        Write-Host "❌ No Service Bus namespace found" -ForegroundColor Red
    }
} catch {
    Write-Host "⚠️ Service Bus test failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Test Key Vault
Write-Host "`n=== Testing Key Vault ===" -ForegroundColor Cyan

try {
    $kvName = az keyvault list --resource-group $ResourceGroup --query "[].name" -o tsv
    if ($kvName) {
        $kvName = $kvName.Split("`n")[0]
        Write-Host "Key Vault: $kvName" -ForegroundColor Green
        
        # Test access to a secret
        $secretTest = az keyvault secret show --vault-name $kvName --name "OPENAI-API-KEY" --query "value" -o tsv
        if ($secretTest) {
            Write-Host "✓ Key Vault secrets accessible" -ForegroundColor Green
        } else {
            Write-Host "⚠️ Key Vault accessible but secrets may not be configured" -ForegroundColor Yellow
        }
    } else {
        Write-Host "❌ No Key Vault found" -ForegroundColor Red
    }
} catch {
    Write-Host "⚠️ Key Vault test failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "`n=== Test Summary ===" -ForegroundColor Cyan
Write-Host "Function App: https://$funcUrl" -ForegroundColor Green
Write-Host "Static Web App: https://$swaUrl" -ForegroundColor Green
Write-Host ""
Write-Host "To test the voice agent:" -ForegroundColor Yellow
Write-Host "1. Visit the Static Web App URL" -ForegroundColor White
Write-Host "2. Enter your Nylas API Key and Grant ID" -ForegroundColor White
Write-Host "3. Click 'Connect Voice Agent'" -ForegroundColor White
Write-Host "4. Grant microphone access and test voice commands" -ForegroundColor White
