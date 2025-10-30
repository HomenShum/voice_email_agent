# Remove Incompatible App Settings for Flex Consumption Plan
# This script forcefully removes settings that are not supported by Flex Consumption SKU

param(
    [string]$FuncAppName = "",
    [string]$ResourceGroup = "rg-email-agent"
)

# If no function app name provided, try to get it from GitHub secrets or prompt
if ([string]::IsNullOrEmpty($FuncAppName)) {
    Write-Host "Function App name not provided. Attempting to find it..." -ForegroundColor Yellow
    
    # Try to list function apps in the resource group
    $apps = az functionapp list --resource-group $ResourceGroup --query "[].name" -o tsv
    
    if ($apps) {
        $appArray = $apps -split "`n"
        if ($appArray.Count -eq 1) {
            $FuncAppName = $appArray[0].Trim()
            Write-Host "Found Function App: $FuncAppName" -ForegroundColor Green
        } else {
            Write-Host "Multiple Function Apps found:" -ForegroundColor Yellow
            $appArray | ForEach-Object { Write-Host "  - $_" }
            $FuncAppName = Read-Host "Enter the Function App name"
        }
    } else {
        $FuncAppName = Read-Host "Enter the Function App name"
    }
}

Write-Host "`n=== Removing Incompatible App Settings ===" -ForegroundColor Cyan
Write-Host "Function App: $FuncAppName" -ForegroundColor White
Write-Host "Resource Group: $ResourceGroup" -ForegroundColor White
Write-Host ""

# List of incompatible settings for Flex Consumption
$incompatibleSettings = @(
    "WEBSITE_RUN_FROM_PACKAGE",
    "SCM_DO_BUILD_DURING_DEPLOYMENT",
    "ENABLE_ORYX_BUILD"
)

Write-Host "Checking current app settings..." -ForegroundColor Cyan
$currentSettings = az functionapp config appsettings list `
    --name $FuncAppName `
    --resource-group $ResourceGroup `
    --query "[].name" -o tsv

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to retrieve app settings" -ForegroundColor Red
    exit 1
}

$settingsArray = $currentSettings -split "`n" | ForEach-Object { $_.Trim() }

Write-Host "Found $($settingsArray.Count) total app settings" -ForegroundColor White
Write-Host ""

# Check which incompatible settings exist
$settingsToRemove = @()
foreach ($setting in $incompatibleSettings) {
    if ($settingsArray -contains $setting) {
        Write-Host "  ❌ Found incompatible setting: $setting" -ForegroundColor Red
        $settingsToRemove += $setting
    } else {
        Write-Host "  ✓ Setting not present: $setting" -ForegroundColor Green
    }
}

Write-Host ""

if ($settingsToRemove.Count -eq 0) {
    Write-Host "No incompatible settings found. Function App is ready for deployment!" -ForegroundColor Green
    exit 0
}

$settingCount = $settingsToRemove.Count
Write-Host "Removing $settingCount incompatible setting(s)..." -ForegroundColor Yellow
Write-Host ""

# Remove each setting individually for better error handling
$successCount = 0
$failCount = 0

foreach ($setting in $settingsToRemove) {
    Write-Host "Removing: $setting..." -ForegroundColor Cyan
    
    az functionapp config appsettings delete `
        --name $FuncAppName `
        --resource-group $ResourceGroup `
        --setting-names $setting `
        --output none
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Successfully removed: $setting" -ForegroundColor Green
        $successCount++
    } else {
        Write-Host "  ❌ Failed to remove: $setting" -ForegroundColor Red
        $failCount++
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Successfully removed: $successCount" -ForegroundColor Green
$failColor = if ($failCount -gt 0) { "Red" } else { "Green" }
Write-Host "Failed to remove: $failCount" -ForegroundColor $failColor

if ($failCount -gt 0) {
    Write-Host ""
    Write-Host "Some settings could not be removed automatically." -ForegroundColor Yellow
    Write-Host "Please remove them manually via Azure Portal:" -ForegroundColor Yellow
    Write-Host "1. Go to: https://portal.azure.com" -ForegroundColor White
    Write-Host "2. Navigate to: Function App -> $FuncAppName -> Configuration" -ForegroundColor White
    Write-Host "3. Delete the following settings:" -ForegroundColor White
    foreach ($setting in $settingsToRemove) {
        Write-Host "   - $setting" -ForegroundColor White
    }
    Write-Host "4. Click 'Save' and confirm" -ForegroundColor White
    exit 1
}

Write-Host ""
Write-Host "All incompatible settings removed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Restart the Function App to apply changes:" -ForegroundColor White
Write-Host "   az functionapp restart --name $FuncAppName --resource-group $ResourceGroup" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Re-run the GitHub Actions deployment:" -ForegroundColor White
Write-Host "   https://github.com/HomenShum/voice_email_agent/actions" -ForegroundColor Gray
Write-Host ""

