# CRITICAL DISCOVERY: Wrong Hosting Plan! ⚠️

> **✅ RESOLVED - HISTORICAL REFERENCE**
> This issue has been resolved. The project now correctly uses **Windows Consumption** plan (`func-email-agent-9956`).
> This document is kept for historical reference.

## The Real Problem

After extensive troubleshooting, we discovered that **`func-email-agent-9956` is NOT a Flex Consumption plan**. It's a **Windows Consumption plan**.

### Evidence

```bash
az functionapp show --name func-email-agent-9956 --resource-group rg-email-agent \
  --query "{Name:name, Kind:kind, SKU:sku, Reserved:reserved}" -o json

# Result:
{
  "Kind": "functionapp",           # Windows Consumption (NOT Flex)
  "Name": "func-email-agent-9956",
  "Reserved": false,               # Windows (Linux would be true)
  "SKU": null,
  "State": "Running"
}
```

### All Function Apps in Resource Group

| Name | Kind | Reserved | Plan Type |
|------|------|----------|-----------|
| func-email-agent-9956 | functionapp,linux | True | Linux Consumption |
| func-email-agent-4707 | functionapp,linux | True | Linux Consumption |
| **func-email-agent-9956** | **functionapp** | **False** | **Windows Consumption** |
| func-email-agent-3624 | functionapp,linux | True | Linux Consumption |
| func-email-agent-2699 | functionapp,linux | True | Linux Consumption |
| func-email-agent-9956-lnx | functionapp,linux | True | Linux Consumption |

**None of these are Flex Consumption plans!**

## Why This Matters

### 1. The Error Messages Were Misleading

The `InvalidAppSettingsException` error about `WEBSITE_RUN_FROM_PACKAGE` being incompatible was confusing because:

- **Windows Consumption plans DO support** `WEBSITE_RUN_FROM_PACKAGE`
- The error message mentioned "this SKU" but didn't specify which SKU
- We assumed it was a Flex Consumption plan based on the error

### 2. Our "Fixes" Were Unnecessary

All the changes we made to avoid `WEBSITE_RUN_FROM_PACKAGE` were based on the wrong assumption:

- ❌ Switching from `config-zip` to `OneDeploy` (unnecessary for Windows Consumption)
- ❌ Removing `WEBSITE_RUN_FROM_PACKAGE` post-deployment (it's actually needed!)
- ❌ Avoiding `config-zip` (it's the recommended method for Windows Consumption)

### 3. The Real Issue

The deployment failures are likely due to:

1. **Wrong runtime configuration** - Windows Consumption vs. Linux
2. **Wrong deployment package format** - Windows expects different structure than Linux
3. **Missing or incorrect app settings** - Not related to Flex Consumption at all

## How to Identify Flex Consumption Plans

According to Microsoft documentation, Flex Consumption plans have:

```json
{
  "Kind": "functionapp,linux,flexconsumption",  // Note: includes "flexconsumption"
  "Reserved": true,                              // Always Linux
  "SKU": "FlexConsumption"                       // Explicit SKU name
}
```

**None of your Function Apps match this pattern.**

## What Went Wrong

### Timeline of Confusion

1. **Initial Error:** Deployment failed with `InvalidAppSettingsException` about `WEBSITE_RUN_FROM_PACKAGE`
2. **Wrong Assumption:** We assumed this was a Flex Consumption plan based on the error message
3. **Misleading Documentation:** We found Flex Consumption docs that mentioned these settings are incompatible
4. **Incorrect Fixes:** We implemented Flex Consumption-specific workarounds
5. **New Errors:** `OneDeploy` failed with `415 Unsupported Media Type` (because it's not the right method for Windows Consumption)

### The Actual Situation

- **Function App:** `func-email-agent-9956`
- **Actual Plan:** Windows Consumption
- **Expected Deployment Method:** `az functionapp deployment source config-zip` (with `WEBSITE_RUN_FROM_PACKAGE=1`)
- **Expected Settings:** Standard Windows Consumption settings

## Correct Path Forward

### Option 1: Deploy to Existing Windows Consumption Plan (Recommended)

**Revert all Flex Consumption-specific changes:**

1. **Restore `config-zip` deployment:**
   ```yaml
   - name: Deploy Functions (config-zip)
     run: |
       az functionapp deployment source config-zip \
         --resource-group "$RG" \
         --name "$APP_NAME" \
         --src "$ZIP_PATH"
   ```

2. **Remove post-deployment cleanup:**
   - Delete the step that removes `WEBSITE_RUN_FROM_PACKAGE`
   - This setting is REQUIRED for Windows Consumption

3. **Ensure correct app settings:**
   ```bash
   az functionapp config appsettings set \
     --name func-email-agent-9956 \
     --resource-group rg-email-agent \
     --settings \
       WEBSITE_RUN_FROM_PACKAGE=1 \
       AzureWebJobsFeatureFlags=EnableWorkerIndexing
   ```

4. **Verify deployment package:**
   - Ensure the zip contains the correct structure for Windows
   - Include `dist/`, `node_modules/`, `package.json`, `host.json`

### Option 2: Create a NEW Flex Consumption Plan

If you actually need Flex Consumption (for specific features), create a new Function App:

```bash
az functionapp create \
  --resource-group rg-email-agent \
  --name func-email-agent-flex \
  --storage-account <STORAGE_NAME> \
  --flexconsumption-location "East US" \
  --runtime node \
  --runtime-version 20
```

Then update GitHub secrets to point to the new app.

### Option 3: Migrate to Linux Consumption Plan

If you want to use Linux (for better Node.js support), use one of the existing Linux apps:

```bash
# Update GitHub secret AZURE_FUNCTION_APP_NAME to:
# func-email-agent-9956-lnx
```

Then deploy using `config-zip` (Linux Consumption supports it).

## Recommended Action

**I recommend Option 1: Deploy to the existing Windows Consumption plan correctly.**

### Why?

1. **Simplest solution** - Just revert the Flex Consumption-specific changes
2. **No new resources** - Use the existing `func-email-agent-9956`
3. **Well-documented** - Windows Consumption is the most common and well-supported plan
4. **Cost-effective** - Consumption plans are pay-per-execution

### Steps to Fix

1. **Revert workflow to use `config-zip`:**
   - Remove `OneDeploy` deployment
   - Restore `config-zip` deployment
   - Remove post-deployment cleanup

2. **Restore required app settings:**
   ```bash
   az functionapp config appsettings set \
     --name func-email-agent-9956 \
     --resource-group rg-email-agent \
     --settings \
       WEBSITE_RUN_FROM_PACKAGE=1 \
       AzureWebJobsFeatureFlags=EnableWorkerIndexing
   ```

3. **Test deployment:**
   ```bash
   az functionapp deployment source config-zip \
     --resource-group rg-email-agent \
     --name func-email-agent-9956 \
     --src apps/functions.zip
   ```

## Lessons Learned

1. **Always verify the hosting plan type** before troubleshooting
2. **Don't assume based on error messages** - verify with `az functionapp show`
3. **Check the `Kind` field** to identify the actual plan type
4. **Flex Consumption plans explicitly include "flexconsumption" in the Kind field**
5. **Error messages can be misleading** - always verify assumptions

## Next Steps

1. Decide which option to pursue (recommend Option 1)
2. Revert Flex Consumption-specific changes
3. Restore correct Windows Consumption configuration
4. Test deployment
5. Update documentation to reflect actual hosting plan

---

**Status:** Awaiting decision on which option to pursue  
**Recommendation:** Option 1 - Deploy to existing Windows Consumption plan correctly  
**Last Updated:** 2025-10-30

