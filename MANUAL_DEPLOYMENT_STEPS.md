# 🚀 Manual Deployment Steps

Since there are execution environment limitations, please follow these steps manually in PowerShell or Command Prompt.

## Step 1: Update .env.production with Your Values

First, copy your actual values from `.env` to `.env.production`:

1. Open your `.env` file (it's hidden from git for security)
2. Copy these key values to `.env.production`:
   - `OPENAI_API_KEY=sk-proj-...`
   - `PINECONE_API_KEY=pcsk_...`
   - `PINECONE_INDEX_HOST=https://emails-....pinecone.io`
   - `NYLAS_API_KEY=nyk_v0_...`
   - `NYLAS_GRANT_ID=22dd5c25-157e-4377-af23-e06602fdfcec`

## Step 2: Run Azure Deployment Scripts

Open PowerShell as Administrator and run:

```powershell
# Navigate to project directory
cd "d:\VSCode Projects\Real_time_voice_email_agent\my-project"

# 1. Deploy Azure infrastructure
.\deploy-azure.ps1

# 2. Configure application settings
.\configure-app-settings.ps1

# 3. Deploy Functions (after infrastructure is ready)
cd apps/functions
func azure functionapp publish func-email-agent-XXXX --build remote

# 4. Deploy Frontend
cd ../..
.\deploy-frontend-azure.ps1

# 5. Register Nylas webhook
.\scripts\register-nylas-webhook.ps1 -FuncAppName "func-email-agent-XXXX" -ResourceGroup "rg-email-agent"
```

## Step 3: Test the Deployment

```powershell
# Get Function App URL
$FUNC_URL = az functionapp show --name func-email-agent-XXXX --resource-group rg-email-agent --query defaultHostName -o tsv

# Test endpoints
curl "https://$FUNC_URL/api/index/stats"
curl -X POST "https://$FUNC_URL/api/search" -H "Content-Type: application/json" -d '{"grantId":"22dd5c25-157e-4377-af23-e06602fdfcec","query":"meeting notes","topK":5}'
```

## Step 4: Set Up GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions → New repository secret

Add these secrets:

### Azure Authentication Secrets:
- `AZURE_CLIENT_ID`: Get from Azure AD app registration
- `AZURE_TENANT_ID`: Your Azure tenant ID
- `AZURE_SUBSCRIPTION_ID`: `d33edd77-3a20-49e3-8dbd-93f0344b235e`

### Azure Resource Secrets:
- `AZURE_FUNCTION_APP_NAME`: `func-email-agent-XXXX` (replace with actual name from deployment)
- `AZURE_STATIC_WEB_APP_NAME`: `swa-email-agent`
- `AZURE_FUNCTION_APP_URL`: `https://func-email-agent-XXXX.azurewebsites.net`

### Deployment Secrets:
- `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`: Get from Azure Portal
  1. Go to Function App in Azure Portal
  2. Go to "Deployment Center" → "Credentials"
  3. Copy the SCM publish profile
- `AZURE_STATIC_WEB_APPS_API_TOKEN`: Get from Azure Portal
  1. Go to Static Web App in Azure Portal
  2. Go to "Manage API tokens"
  3. Create and copy deployment token

## Step 5: Get Required Values for GitHub Secrets

Run these commands to get the values you need:

```powershell
# Get Azure AD info (if not already set up)
az ad sp create-for-rbac --name "github-actions-email-agent" --role contributor --scopes /subscriptions/d33edd77-3a20-49e3-8dbd-93f0344b235e --json-auth

# Get Function App publish profile
az functionapp deployment list-publishing-profiles --name func-email-agent-XXXX --resource-group rg-email-agent --xml

# Get Static Web App deployment token
az staticwebapp secrets list --name swa-email-agent --resource-group rg-email-agent --query "properties.apiKey" -o tsv
```

## Step 6: Trigger CI/CD Pipeline

Once secrets are set up, the pipeline will automatically run on pushes to main branch, or you can trigger it manually:

1. Go to Actions tab in GitHub
2. Select "Deploy to Azure" workflow
3. Click "Run workflow"

## Troubleshooting

If you encounter issues:

1. **Azure CLI not authenticated**: Run `az login`
2. **Providers not registered**: Run `.\scripts\wait-azure-providers.ps1`
3. **Function App not found**: Check deployment output for actual resource names
4. **Permission errors**: Ensure you have Owner/Contributor role on subscription

## Expected Resource Names (from deployment)

After running `deploy-azure.ps1`, you'll see output like:
```
Resource Group: rg-email-agent
Service Bus: sb-email-agent-3512
Functions App: func-email-agent-5231
Storage Account: stemail123456
Key Vault: kv-email-agent-7890
```

Use these actual names in the subsequent steps.
