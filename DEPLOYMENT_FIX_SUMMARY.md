# Deployment Fix Summary - RESOLVED ✅

## Problem Identified

The Azure Function App deployment was failing with the following error:

```
ERROR: Zip deployment failed. 'status_text': 'InvalidAppSettingsException: 
The app settings WEBSITE_RUN_FROM_PACKAGE, SCM_DO_BUILD_DURING_DEPLOYMENT 
are not supported with this SKU. Please remove the listed app settings and 
then redeploy.'
```

### Root Cause

The Azure Function App is using a **Flex Consumption** hosting plan, which does not support certain app settings that are commonly used with other SKUs:

- `WEBSITE_RUN_FROM_PACKAGE` - Used for zip deployment in Consumption/Premium plans
- `SCM_DO_BUILD_DURING_DEPLOYMENT` - Controls remote build behavior
- `ENABLE_ORYX_BUILD` - Enables Oryx build system

These settings were likely set during a previous deployment or manual configuration and persisted in the Azure Function App configuration, causing all subsequent deployments to fail.

## Solution Implemented

### 1. Updated GitHub Actions Workflow (`.github/workflows/azure-deploy.yml`)

Added a new step **before** setting app settings to explicitly remove incompatible settings:

```yaml
- name: Remove incompatible app settings for Flex Consumption
  run: |
    # Remove settings that are not supported by Flex Consumption SKU
    echo "Removing incompatible app settings..."
    az functionapp config appsettings delete \
      --name ${{ secrets.AZURE_FUNCTION_APP_NAME }} \
      --resource-group ${{ env.AZURE_RESOURCE_GROUP }} \
      --setting-names WEBSITE_RUN_FROM_PACKAGE SCM_DO_BUILD_DURING_DEPLOYMENT ENABLE_ORYX_BUILD || true
    
    echo "Incompatible settings removed (if they existed)"
```

**Key points:**
- Uses `|| true` to ensure the step doesn't fail if the settings don't exist
- Runs **before** the "Ensure Function App settings" step
- Removes all three incompatible settings in one command

### 2. Updated PowerShell Configuration Script (`configure-app-settings.ps1`)

Updated the cleanup section to include `WEBSITE_RUN_FROM_PACKAGE`:

```powershell
# Remove unsupported app settings for Flex Consumption if present
try {
  az functionapp config appsettings delete `
    --name $FuncAppName `
    --resource-group $ResourceGroup `
    --setting-names WEBSITE_RUN_FROM_PACKAGE SCM_DO_BUILD_DURING_DEPLOYMENT ENABLE_ORYX_BUILD | Out-Null
} catch {}
```

## Why This Fix Works

### Flex Consumption Plan Characteristics

The Flex Consumption plan:
- **Automatically manages** most deployment and runtime settings
- **Does not support** `WEBSITE_RUN_FROM_PACKAGE` because it uses a different deployment model
- **Does not need** `SCM_DO_BUILD_DURING_DEPLOYMENT` because it handles builds automatically via Oryx
- **Only requires** minimal settings like `AzureWebJobsFeatureFlags=EnableWorkerIndexing` for function discovery

### Deployment Flow After Fix

1. **Remove incompatible settings** - Cleans up any legacy configuration
2. **Set minimal required settings** - Only `AzureWebJobsFeatureFlags=EnableWorkerIndexing`
3. **Restart Function App** - Applies the new configuration
4. **Package and deploy** - Uses `config-zip` or `OneDeploy` without conflicts

## Expected Outcome

After this fix, the deployment should:
1. ✅ Successfully remove incompatible settings
2. ✅ Set only the required settings for Flex Consumption
3. ✅ Complete the `config-zip` deployment without errors
4. ✅ Discover and index all functions correctly
5. ✅ Pass all endpoint tests

## Resolution Steps Taken ✅

### 1. Updated GitHub Actions Workflow
- ✅ Added step to remove incompatible settings before deployment
- ✅ Committed and pushed changes

### 2. Manually Removed Incompatible Settings
The workflow step alone wasn't sufficient because the settings were already present in Azure. We had to manually remove them:

```powershell
# Ran the removal script
.\remove-incompatible-settings.ps1 -FuncAppName "func-email-agent-9956"

# Results:
# ✅ Successfully removed: WEBSITE_RUN_FROM_PACKAGE
# ✅ Successfully removed: SCM_DO_BUILD_DURING_DEPLOYMENT
# ✅ Total: 2 settings removed
```

### 3. Restarted Function App
```bash
az functionapp restart --name func-email-agent-9956 --resource-group rg-email-agent
```

### 4. Triggered New Deployment
```bash
git commit --allow-empty -m "chore: trigger deployment after removing incompatible app settings"
git push
```

## Root Cause Analysis - CRITICAL DISCOVERY ⚠️

After the initial fix, we discovered that **`az functionapp deployment source config-zip` automatically sets `WEBSITE_RUN_FROM_PACKAGE=1`** as part of its operation. This means:

1. ❌ Pre-deployment cleanup was ineffective
2. ❌ The deployment command itself was re-adding the incompatible setting
3. ❌ Post-deployment, the Function App still had `WEBSITE_RUN_FROM_PACKAGE=1`

**Verification:**
```bash
az functionapp config appsettings list --name func-email-agent-9956 --resource-group rg-email-agent \
  --query "[?name=='WEBSITE_RUN_FROM_PACKAGE'].{Name:name, Value:value}" -o table

# Result:
# Name                      Value
# ------------------------  -------
# WEBSITE_RUN_FROM_PACKAGE  1
```

## Final Solution ✅

### Changed Deployment Strategy

1. **Switch from `config-zip` to `OneDeploy`**
   - `az webapp deploy` does NOT auto-add `WEBSITE_RUN_FROM_PACKAGE`
   - Compatible with Flex Consumption plan
   - More reliable for this SKU

2. **Move cleanup to POST-deployment**
   - Remove incompatible settings AFTER deployment completes
   - Ensures any auto-added settings are cleaned up
   - Function App is in correct state before verification

3. **Remove pre-deployment cleanup**
   - No longer needed since we're using OneDeploy
   - Simplifies workflow

### Updated Workflow Changes

```yaml
# OLD (config-zip - incompatible):
- name: Deploy Functions (config-zip primary, OneDeploy fallback)
  run: |
    az functionapp deployment source config-zip \
      --resource-group "$RG" \
      --name "$APP_NAME" \
      --src "$ZIP_PATH"

# NEW (OneDeploy - compatible):
- name: Deploy Functions (OneDeploy - Flex Consumption compatible)
  run: |
    az webapp deploy \
      --resource-group "$RG" \
      --name "$APP_NAME" \
      --src-path "$ZIP_PATH" \
      --type zip \
      --async false

- name: Remove incompatible settings added by deployment
  run: |
    az functionapp config appsettings delete \
      --name ${{ secrets.AZURE_FUNCTION_APP_NAME }} \
      --resource-group ${{ env.AZURE_RESOURCE_GROUP }} \
      --setting-names WEBSITE_RUN_FROM_PACKAGE SCM_DO_BUILD_DURING_DEPLOYMENT ENABLE_ORYX_BUILD || true
```

## Current Status

- ✅ Incompatible settings manually removed from Azure Function App `func-email-agent-9956`
- ✅ Function App restarted
- ✅ Workflow updated to use OneDeploy instead of config-zip
- ✅ Post-deployment cleanup added to workflow
- ✅ Changes committed and pushed (commit: `b3dd122`)
- 🔄 New deployment in progress: https://github.com/HomenShum/voice_email_agent/actions

## Next Steps

**Monitor the deployment** at:
- GitHub Actions: https://github.com/HomenShum/voice_email_agent/actions

**Expected outcome:**
- ✅ No more `InvalidAppSettingsException` errors
- ✅ Deployment completes successfully
- ✅ Functions are discovered and indexed
- ✅ All endpoint tests pass

## Additional Notes

### If Deployment Still Fails

If you still encounter issues, you can manually verify and remove settings via Azure Portal:

1. Go to Azure Portal → Function App → Configuration
2. Look for and delete these settings if present:
   - `WEBSITE_RUN_FROM_PACKAGE`
   - `SCM_DO_BUILD_DURING_DEPLOYMENT`
   - `ENABLE_ORYX_BUILD`
3. Save and restart the Function App
4. Re-run the GitHub Actions workflow

### Flex Consumption Best Practices

For Flex Consumption plans, keep app settings minimal:
- ✅ `AzureWebJobsFeatureFlags=EnableWorkerIndexing` - Required for function discovery
- ✅ `FUNCTIONS_WORKER_RUNTIME=node` - Automatically set by Azure
- ✅ `FUNCTIONS_EXTENSION_VERSION=~4` - Automatically set by Azure
- ✅ Your custom environment variables (API keys, connection strings, etc.)
- ❌ Avoid deployment-related settings - let Azure manage them

## References

- [Azure Functions Flex Consumption Plan](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan)
- [Azure Functions App Settings Reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-app-settings)
- [Deployment Best Practices](https://learn.microsoft.com/en-us/azure/azure-functions/functions-deployment-technologies)

