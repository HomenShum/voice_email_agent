# 🎯 Next Steps to Complete Deployment

## Immediate Actions Required

### Step 1: Add GitHub Secrets (5 minutes)

I've opened the GitHub secrets page in your browser: https://github.com/HomenShum/voice_email_agent/settings/secrets/actions

Add these 7 secrets by clicking **"New repository secret"** for each:

| Secret Name | Value |
|-------------|-------|
| `AZURE_CLIENT_ID` | `813b9273-87e9-495f-a643-f696c54280f1` |
| `AZURE_TENANT_ID` | `19683f98-b1bc-402c-a9d1-0166ef1607f9` |
| `AZURE_SUBSCRIPTION_ID` | `d33edd77-3a20-49e3-8dbd-93f0344b235e` |
| `AZURE_FUNCTION_APP_NAME` | `func-email-agent-8127` |
| `AZURE_FUNCTION_APP_URL` | `https://func-email-agent-8127.azurewebsites.net` |
| `AZURE_STATIC_WEB_APP_NAME` | `swa-email-agent` |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | `dc3f12ee59032ac71685638091329f98ba17b1bfc95cae2d1d3983993be9356703-437bf6a9-79e4-49cc-8225-d3b6f51610ec00f0832087b3a60f` |

**Detailed instructions:** See `GITHUB_SECRETS_SETUP.md`

---

### Step 2: Trigger GitHub Actions Deployment (2 minutes)

After adding the secrets, deploy using GitHub Actions:

**Option A: Push to main branch**
```bash
git add .
git commit -m "Configure Azure deployment with GitHub Actions"
git push origin main
```

**Option B: Manual workflow dispatch**
1. Go to: https://github.com/HomenShum/voice_email_agent/actions
2. Click on "Deploy to Azure" workflow
3. Click "Run workflow" → "Run workflow"

---

### Step 3: Monitor Deployment (5-10 minutes)

1. Watch the GitHub Actions workflow: https://github.com/HomenShum/voice_email_agent/actions
2. Wait for both jobs to complete:
   - ✅ `deploy-functions` - Deploys Azure Functions
   - ✅ `deploy-frontend` - Deploys Static Web App
   - ✅ `configure-cors` - Sets up CORS between frontend and backend

---

### Step 4: Verify Functions Are Working (2 minutes)

After deployment completes, test the endpoints:

```bash
# Test index stats
curl https://func-email-agent-8127.azurewebsites.net/api/index-stats

# Expected response: JSON with Pinecone index statistics
```

If you still get 404 errors, check Application Insights:
```bash
az monitor app-insights query \
  --app func-email-agent-8127 \
  --resource-group rg-email-agent \
  --analytics-query "traces | where timestamp > ago(30m) | order by timestamp desc | take 50"
```

---

### Step 5: Register Nylas Webhook (1 minute)

Once functions are working, register the webhook:

```powershell
.\scripts\register-nylas-webhook.ps1 -FuncAppName "func-email-agent-8127"
```

This will configure Nylas to send email events to:
`https://func-email-agent-8127.azurewebsites.net/api/nylas/webhook`

---

### Step 6: Test End-to-End (5 minutes)

1. **Test Frontend:**
   - Open: https://orange-mud-087b3a60f.3.azurestaticapps.net
   - Verify the UI loads correctly
   - Check browser console for any errors

2. **Test Search:**
   ```bash
   curl -X POST https://func-email-agent-8127.azurewebsites.net/api/search \
     -H "Content-Type: application/json" \
     -d '{"query": "test", "topK": 5}'
   ```

3. **Test Aggregate:**
   ```bash
   curl -X POST https://func-email-agent-8127.azurewebsites.net/api/aggregate \
     -H "Content-Type: application/json" \
     -d '{"query": "summarize emails from this week"}'
   ```

4. **Test Backfill:**
   ```bash
   curl -X POST https://func-email-agent-8127.azurewebsites.net/api/sync/backfill/start \
     -H "Content-Type: application/json" \
     -d '{}'
   ```

---

## Troubleshooting

### If Functions Still Show "0 functions loaded"

This is the current issue. The GitHub Actions deployment should fix it, but if not:

**Possible causes:**
1. Worker indexing not working correctly
2. Build output structure doesn't match Azure expectations
3. ESM module resolution issues

**Solutions to try:**

1. **Check the deployment logs in GitHub Actions** for any build errors

2. **Verify the package structure** after deployment:
   ```bash
   # SSH into the Function App (if available)
   # Or check the deployment logs
   ```

3. **Try a different build approach** - flatten the output:
   ```bash
   # Modify tsconfig.json to output flat structure
   # Or create a post-build script to reorganize files
   ```

4. **Check if functions need to be in separate folders** with function.json files (v3 style):
   - This might require a hybrid approach
   - Or switching to v3 programming model

---

### If CORS Errors Occur

The GitHub Actions workflow automatically configures CORS, but if you see CORS errors:

```bash
az functionapp cors add \
  --name func-email-agent-8127 \
  --resource-group rg-email-agent \
  --allowed-origins "https://orange-mud-087b3a60f.3.azurestaticapps.net"
```

---

### If Webhook Registration Fails

Check that:
1. Functions are accessible (test `/api/nylas/webhook` endpoint)
2. `NYLAS_API_KEY` and `NYLAS_GRANT_ID` are set correctly
3. `NYLAS_WEBHOOK_SECRET` matches between Nylas and Azure

---

## Success Checklist

- [ ] GitHub secrets added (7 secrets)
- [ ] GitHub Actions workflow triggered
- [ ] Functions deployed successfully
- [ ] Frontend deployed successfully
- [ ] CORS configured
- [ ] Functions discovered (not "0 functions loaded")
- [ ] `/api/index-stats` returns 200 OK
- [ ] Nylas webhook registered
- [ ] End-to-end tests passing
- [ ] Frontend can communicate with backend
- [ ] Service Bus queue processing emails

---

## Resources Created

### Azure Resources
- **Resource Group:** `rg-email-agent`
- **Function App:** `func-email-agent-8127` (Flex Consumption)
- **Static Web App:** `swa-email-agent` (Free tier)
- **Service Bus:** `sb-email-agent-4003` (Standard)
- **Storage:** `stemail343069` (Standard LRS)
- **App Insights:** `func-email-agent-8127`
- **Key Vault:** `kv-email-agent-5962`

### URLs
- **Function App:** https://func-email-agent-8127.azurewebsites.net
- **Static Web App:** https://orange-mud-087b3a60f.3.azurestaticapps.net
- **Azure Portal:** https://portal.azure.com/#@/resource/subscriptions/d33edd77-3a20-49e3-8dbd-93f0344b235e/resourceGroups/rg-email-agent

### Service Principal
- **Name:** `github-actions-voice-email-agent`
- **Client ID:** `813b9273-87e9-495f-a643-f696c54280f1`
- **Role:** Contributor on `rg-email-agent`

---

## Documentation

- **DEPLOYMENT_STATUS.md** - Current deployment status and troubleshooting
- **GITHUB_SECRETS_SETUP.md** - Detailed GitHub secrets setup guide
- **.env** - Environment variables (updated with Azure URLs)
- **.github/workflows/azure-deploy.yml** - CI/CD pipeline

---

## Estimated Time to Complete

- **Step 1 (GitHub Secrets):** 5 minutes
- **Step 2 (Trigger Deployment):** 2 minutes
- **Step 3 (Monitor):** 5-10 minutes
- **Step 4 (Verify):** 2 minutes
- **Step 5 (Webhook):** 1 minute
- **Step 6 (E2E Tests):** 5 minutes

**Total:** ~20-25 minutes

---

## What I've Completed

✅ Created all Azure infrastructure
✅ Configured Service Bus with session-enabled queue
✅ Deployed Function App (but functions not discovered yet)
✅ Created Static Web App
✅ Created Service Principal for GitHub Actions
✅ Updated `.env` with all Azure URLs
✅ Created GitHub Actions workflow
✅ Generated deployment documentation
✅ Opened GitHub secrets page in browser

---

## What You Need to Do

1. **Add the 7 GitHub secrets** (browser is already open to the right page)
2. **Trigger the GitHub Actions workflow** (push to main or manual dispatch)
3. **Monitor the deployment** and verify functions are working
4. **Register Nylas webhook** once functions are accessible
5. **Test the application** end-to-end

---

## Need Help?

If you encounter any issues:

1. Check the **DEPLOYMENT_STATUS.md** for troubleshooting commands
2. Review **Application Insights** logs for errors
3. Check **GitHub Actions** workflow logs for deployment issues
4. Verify all **environment variables** are set correctly

The main blocker right now is the "0 functions loaded" issue, which should be resolved by the GitHub Actions deployment using the proper build and deployment process.

