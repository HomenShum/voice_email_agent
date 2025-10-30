# Azure Functions Flex Consumption Plan - Quick Reference Guide

## Overview

This guide documents the specific requirements and limitations of Azure Functions **Flex Consumption** hosting plan, based on real deployment experience with this project.

## Incompatible App Settings ⚠️

The following app settings are **NOT supported** by Flex Consumption plans and will cause deployment failures:

| Setting | Purpose | Why Incompatible |
|---------|---------|------------------|
| `WEBSITE_RUN_FROM_PACKAGE` | Tells Azure to run directly from deployment package | Flex Consumption manages deployment differently |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | Controls remote build behavior | Flex Consumption has its own build process |
| `ENABLE_ORYX_BUILD` | Enables Oryx build system | Not needed for Flex Consumption |

### Error Message

If these settings are present, you'll see:

```
ERROR: Zip deployment failed.
'status_text': 'InvalidAppSettingsException: The app settings WEBSITE_RUN_FROM_PACKAGE, 
SCM_DO_BUILD_DURING_DEPLOYMENT are not supported with this SKU. 
Please remove the listed app settings and then redeploy.'
```

## Deployment Methods

### ❌ Avoid: `az functionapp deployment source config-zip`

**Problem:** This command **automatically sets** `WEBSITE_RUN_FROM_PACKAGE=1`, which is incompatible with Flex Consumption.

```bash
# DON'T USE THIS for Flex Consumption:
az functionapp deployment source config-zip \
  --resource-group "$RG" \
  --name "$APP_NAME" \
  --src "$ZIP_PATH"
```

### ✅ Use: `az webapp deploy` (OneDeploy)

**Solution:** Use OneDeploy method, which does NOT auto-add incompatible settings.

```bash
# USE THIS for Flex Consumption:
az webapp deploy \
  --resource-group "$RG" \
  --name "$APP_NAME" \
  --src-path "$ZIP_PATH" \
  --type zip \
  --async false
```

## Required App Settings

For Flex Consumption with Azure Functions v4, you only need:

```bash
az functionapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RG" \
  --settings \
    AzureWebJobsFeatureFlags=EnableWorkerIndexing
```

All other settings (storage, runtime, etc.) are managed automatically by the Flex Consumption plan.

## Deployment Workflow Pattern

### Correct Order

1. **Set required settings** (EnableWorkerIndexing)
2. **Restart Function App** (apply settings)
3. **Deploy using OneDeploy** (az webapp deploy)
4. **Remove incompatible settings** (cleanup any auto-added settings)
5. **Verify functions discovered**
6. **Test endpoints**

### Example GitHub Actions Workflow

```yaml
- name: Ensure Function App settings (Flex Consumption compatible)
  run: |
    az functionapp config appsettings set \
      --name ${{ secrets.AZURE_FUNCTION_APP_NAME }} \
      --resource-group ${{ env.AZURE_RESOURCE_GROUP }} \
      --settings \
        AzureWebJobsFeatureFlags=EnableWorkerIndexing

- name: Restart Function App to apply settings
  run: |
    az functionapp restart \
      --name ${{ secrets.AZURE_FUNCTION_APP_NAME }} \
      --resource-group ${{ env.AZURE_RESOURCE_GROUP }}
    sleep 30

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

## Troubleshooting Commands

### Check for Incompatible Settings

```bash
az functionapp config appsettings list \
  --name func-email-agent-9956 \
  --resource-group rg-email-agent \
  --query "[?name=='WEBSITE_RUN_FROM_PACKAGE' || name=='SCM_DO_BUILD_DURING_DEPLOYMENT' || name=='ENABLE_ORYX_BUILD'].{Name:name, Value:value}" \
  -o table
```

### Remove Incompatible Settings Manually

```bash
az functionapp config appsettings delete \
  --name func-email-agent-9956 \
  --resource-group rg-email-agent \
  --setting-names WEBSITE_RUN_FROM_PACKAGE SCM_DO_BUILD_DURING_DEPLOYMENT ENABLE_ORYX_BUILD
```

### Verify Function App Status

```bash
# Check Function App state
az functionapp list \
  --resource-group rg-email-agent \
  --query "[?name=='func-email-agent-9956'].{Name:name, State:state, Kind:kind}" \
  -o table

# List discovered functions
az functionapp function list \
  --name func-email-agent-9956 \
  --resource-group rg-email-agent \
  --query "[].{Name:name, Language:language}" \
  -o table
```

## PowerShell Cleanup Script

Use the provided `remove-incompatible-settings.ps1` script:

```powershell
# Auto-detect Function App
.\remove-incompatible-settings.ps1

# Or specify Function App name
.\remove-incompatible-settings.ps1 -FuncAppName "func-email-agent-9956"
```

## Common Pitfalls

### 1. Pre-deployment Cleanup Doesn't Work

**Problem:** Removing settings before deployment doesn't help if the deployment command re-adds them.

**Solution:** Always clean up AFTER deployment.

### 2. Using config-zip by Habit

**Problem:** `config-zip` is the most common deployment method, but it's incompatible with Flex Consumption.

**Solution:** Always use `az webapp deploy` (OneDeploy) for Flex Consumption plans.

### 3. Forgetting to Restart After Settings Changes

**Problem:** Settings changes don't take effect until the Function App restarts.

**Solution:** Always restart after changing settings, and wait 30+ seconds for the restart to complete.

## References

- [Azure Functions Flex Consumption Plan Documentation](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan)
- [Azure Functions v4 Programming Model](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node)
- [Deployment Methods for Azure Functions](https://learn.microsoft.com/en-us/azure/azure-functions/functions-deployment-technologies)

## Project-Specific Notes

- **Function App Name:** `func-email-agent-9956`
- **Resource Group:** `rg-email-agent`
- **Runtime:** Node.js v22, Azure Functions v4
- **Programming Model:** v4 (ESM modules)
- **Required Feature Flag:** `AzureWebJobsFeatureFlags=EnableWorkerIndexing`

---

**Last Updated:** 2025-10-30  
**Status:** Deployment working with OneDeploy method

