# GitHub Secrets Setup Guide

## Required Secrets

You need to add the following secrets to your GitHub repository for CI/CD to work.

### How to Add Secrets

1. Go to your repository: https://github.com/HomenShum/voice_email_agent
2. Click on **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add each secret below

---

## Secrets to Add

### 1. AZURE_CREDENTIALS

**Name:** `AZURE_CREDENTIALS`

**Value:** See the terminal output from the service principal creation command. It should be a JSON object with:
- `clientId`
- `clientSecret`
- `subscriptionId`
- `tenantId`

**Note:** The client secret was displayed when we created the service principal earlier in the deployment process.

---

### 2. AZURE_FUNCTION_APP_NAME

**Name:** `AZURE_FUNCTION_APP_NAME`

**Value:** `func-email-agent-9956` (Windows Consumption plan)

---

### 3. AZURE_FUNCTION_APP_URL

**Name:** `AZURE_FUNCTION_APP_URL`

**Value:** `https://func-email-agent-9956.azurewebsites.net`

---

### 4. AZURE_STATIC_WEB_APP_NAME

**Name:** `AZURE_STATIC_WEB_APP_NAME`

**Value:** `swa-email-agent`

---

### 5. AZURE_STATIC_WEB_APPS_API_TOKEN

**Name:** `AZURE_STATIC_WEB_APPS_API_TOKEN`

**Value:** `dc3f12ee59032ac71685638091329f98ba17b1bfc95cae2d1d3983993be9356703-437bf6a9-79e4-49cc-8225-d3b6f51610ec00f0832087b3a60f`

**Static Web App URL:** `https://orange-mud-087b3a60f.3.azurestaticapps.net`

---

### 6. AZURE_FUNCTIONAPP_PUBLISH_PROFILE

**Name:** `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`

**Value:** Get the publish profile XML by running:
```powershell
az functionapp deployment list-publishing-profiles --name func-email-agent-9956 --resource-group rg-email-agent --xml
```

**Note:** This is required for Windows Consumption plan deployment via GitHub Actions.

---

### 7. Additional Environment Secrets (Optional - for enhanced security)

For production, you may want to add these as secrets instead of hardcoding in `.env`:

- `OPENAI_API_KEY`
- `PINECONE_API_KEY`
- `NYLAS_API_KEY`
- `NYLAS_GRANT_ID`
- `SERVICEBUS_CONNECTION`

---

## Deployment Resources Created

- **Resource Group:** `rg-email-agent`
- **Function App:** `func-email-agent-8127`
- **Service Bus Namespace:** `sb-email-agent-4003`
- **Service Bus Queue:** `nylas-backfill`
- **Storage Account:** `stemail343069`
- **Application Insights:** `func-email-agent-8127`
- **Key Vault:** `kv-email-agent-5962`

---

## Next Steps After Adding Secrets

1. Push code to trigger the GitHub Actions workflow
2. Monitor the deployment in the **Actions** tab
3. Verify functions are working: `https://func-email-agent-8127.azurewebsites.net/api/index-stats`
4. Register Nylas webhook (run locally):
   ```powershell
   .\scripts\register-nylas-webhook.ps1 -FuncAppName "func-email-agent-8127"
   ```

---

## Troubleshooting

If functions still show "0 functions loaded" after deployment:

1. Check Application Insights logs:
   ```bash
   az monitor app-insights query \
     --app func-email-agent-8127 \
     --resource-group rg-email-agent \
     --analytics-query "traces | where timestamp > ago(1h) | order by timestamp desc | take 50"
   ```

2. Verify the deployment package includes `dist/index.js` and all function files

3. Check that `AzureWebJobsFeatureFlags` is set to `EnableWorkerIndexing` in app settings

---

## Service Principal Details

**Service Principal Name:** `github-actions-voice-email-agent`
**Client ID:** `813b9273-87e9-495f-a643-f696c54280f1`
**Scope:** `/subscriptions/d33edd77-3a20-49e3-8dbd-93f0344b235e/resourceGroups/rg-email-agent`
**Role:** `contributor`

⚠️ **IMPORTANT:** Keep the `clientSecret` secure! Never commit it to your repository.

