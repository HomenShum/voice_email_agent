# Script to copy values from .env to .env.production
# This helps populate the production template with your actual values

Write-Host "Copying values from .env to .env.production..." -ForegroundColor Cyan

# Check if .env exists
if (-not (Test-Path ".env")) {
    Write-Host ".env file not found. Please create it first." -ForegroundColor Red
    exit 1
}

# Read .env file
$envVars = @{}
Get-Content ".env" | ForEach-Object {
    if ($_ -match "^([^=]+)=(.*)$") {
        $envVars[$matches[1]] = $matches[2]
    }
}

# Read .env.production template
$productionLines = Get-Content ".env.production"
$updatedLines = @()

foreach ($line in $productionLines) {
    if ($line -match "^([^=]+)=(.*)$") {
        $key = $matches[1]
        $value = $matches[2]
        
        # If we have this key in .env and the value is not a placeholder, use it
        if ($envVars.ContainsKey($key) -and 
            $envVars[$key] -and 
            -not ($envVars[$key] -match "-here$" -or $envVars[$key] -match "-xxxx$")) {
            $updatedLines += "$key=$($envVars[$key])"
            Write-Host "Updated: $key=$($envVars[$key])" -ForegroundColor Green
        } else {
            $updatedLines += $line
        }
    } else {
        $updatedLines += $line
    }
}

# Write updated .env.production
Set-Content -Path ".env.production" -Value $updatedLines -Encoding UTF8
Write-Host "Values copied to .env.production" -ForegroundColor Green

# Show what we'll be using for deployment
Write-Host "`n=== Configuration Summary ===" -ForegroundColor Cyan
$keysToShow = @("OPENAI_API_KEY", "PINECONE_API_KEY", "PINECONE_INDEX_HOST", "NYLAS_API_KEY", "NYLAS_GRANT_ID")
foreach ($key in $keysToShow) {
    if ($envVars.ContainsKey($key)) {
        $value = $envVars[$key]
        if ($value.Length -gt 20) {
            $displayValue = $value.Substring(0, 20) + "..."
        } else {
            $displayValue = $value
        }
        Write-Host "$key = $displayValue" -ForegroundColor Yellow
    }
}
