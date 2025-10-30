# 🚀 Azure Deployment Guide: Real-Time Voice Email Agent

This comprehensive guide walks you through deploying your Real-Time Voice Email Agent to Azure, including infrastructure setup, backend deployment, frontend hosting, and production configuration.

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Phase 1: Infrastructure Setup](#phase-1-infrastructure-setup)
4. [Phase 2: Backend Deployment](#phase-2-backend-deployment)
5. [Phase 3: Frontend Deployment](#phase-3-frontend-deployment)
6. [Phase 4: Integration & Testing](#phase-4-integration--testing)
7. [Phase 5: Production Hardening](#phase-5-production-hardening)
8. [Monitoring & Troubleshooting](#monitoring--troubleshooting)
9. [CI/CD Pipeline](#cicd-pipeline)
10. [Cost Management](#cost-management)

---

## 🎯 Prerequisites

### Required Tools

```powershell
# Verify installations
az --version          # Azure CLI 2.50+
node --version        # Node.js v22.21.0+
func --version        # Azure Functions Core Tools 4.x
git --version         # Git 2.x
```

### Azure Subscription

- Active subscription with Owner/Contributor role
- Subscription ID: `d33edd77-3a20-49e3-8dbd-93f0344b235e`
- Recommended region: `eastus` (supports Flex Consumption)

### Environment Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/HomenShum/voice_email_agent.git
   cd voice_email_agent
   ```

2. **Install dependencies:**
   ```bash
   # Root dependencies
   npm install
   
   # Functions dependencies
   cd apps/functions
   npm install
   cd ../..
   ```

3. **Configure environment variables:**
   ```bash
   # Copy the example and fill in your values
   cp .env.example .env
   
   # Edit .env with your actual API keys
   # OPENAI_API_KEY, PINECONE_API_KEY, NYLAS_API_KEY, etc.
   ```

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         AZURE CLOUD                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐         ┌─────────────────────────────┐  │
│  │ Static Web App   │────────▶│  Azure Functions (Flex)     │  │
│  │ (Frontend)       │  HTTPS  │  - Node.js 22               │  │
│  │ - Vite build     │         │  - 14 HTTP endpoints        │  │
│  │ - TypeScript     │         │  - 1 Timer trigger          │  │
│  │ - OpenAI Agents  │         │  - 1 Service Bus worker     │  │
│  └──────────────────┘         └─────────────────────────────┘  │
│         │                                │                      │
│         │                                ▼                      │
│         │                     ┌──────────────────────┐          │
│         │                     │  Service Bus Queue   │          │
│         │                     │  - Session-enabled   │          │
│         │                     │  - Per-grant serial  │          │
│         │                     └──────────────────────┘          │
│         │                                │                      │
│         │                                ▼                      │
│         │                     ┌──────────────────────┐          │
│         │                     │ Application Insights │          │
│         │                     │ - Logs & Metrics     │          │
│         │                     │ - Distributed trace  │          │
│         │                     └──────────────────────┘          │
│         │                                                        │
│         └────────────────────────────────────────────────────┐  │
│                                                               │  │
└───────────────────────────────────────────────────────────────┼──┘
                                                                │
                    ┌───────────────────────────────────────────┘
                    │
         ┌──────────▼──────────┐
         │  External Services  │
         ├─────────────────────┤
         │ • OpenAI Realtime   │
         │ • Pinecone Vector   │
         │ • Nylas Email API   │
         └─────────────────────┘
```

---

## 📦 Phase 1: Infrastructure Setup

### 1.1 Run Automated Deployment

Execute the main deployment script:

```powershell
.\deploy-azure.ps1 `
  -SubscriptionId "d33edd77-3a20-49e3-8dbd-93f0344b235e" `
  -ResourceGroup "rg-email-agent" `
  -Location "eastus"
```

**What this creates:**
- ✅ Resource Group: `rg-email-agent`
- ✅ Storage Account: `stemailXXXX` (random suffix)
- ✅ Application Insights: `ai-email-agent-XXXX`
- ✅ Service Bus Namespace: `sb-email-agent-XXXX` (or from `.env`)
- ✅ Service Bus Queue: `nylas-backfill` (session-enabled, 10 max retries)
- ✅ Function App: `func-email-agent-XXXX` (Flex Consumption, Node 22)
- ✅ Key Vault: `kv-email-agent-XXXX` (for secure secret storage)

### 1.2 Configure Application Settings

```powershell
.\configure-app-settings.ps1 `
  -FuncAppName "func-email-agent-XXXX" `
  -ResourceGroup "rg-email-agent" `
  -SbNamespace "sb-email-agent-XXXX" `
  -QueueName "nylas-backfill"
```

This script:
- Loads API keys from your `.env` file
- Stores secrets in Azure Key Vault
- Configures Function App settings with Key Vault references
- Sets up Node.js runtime configuration

---

## 📦 Phase 2: Backend Deployment

### 2.1 Build Azure Functions

```powershell
cd apps/functions

# Install dependencies
npm install

# Build TypeScript
npm run build

# Verify build output
ls dist/
# Should show: index.js, functions/, shared/, smoke/
```

### 2.2 Deploy to Azure

**Option A: Remote Build (Recommended)**
```powershell
func azure functionapp publish func-email-agent-XXXX --build remote
```

**Option B: Local Build + Deploy**
```powershell
func azure functionapp publish func-email-agent-XXXX --nozip
```

### 2.3 Verify Deployment

**Test HTTP endpoints:**
```powershell
# Get Function App URL
$FUNC_URL = az functionapp show `
  --name func-email-agent-XXXX `
  --resource-group rg-email-agent `
  --query defaultHostName -o tsv

# Test health endpoint
curl "https://$FUNC_URL/api/index/stats"

# Test search endpoint
curl -X POST "https://$FUNC_URL/api/search" `
  -H "Content-Type: application/json" `
  -d '{"grantId":"your-grant-id","query":"meeting notes","topK":5}'
```

**Check Function App logs:**
```powershell
# Stream live logs
func azure functionapp logstream func-email-agent-XXXX
```

---

## 📦 Phase 3: Frontend Deployment

### 3.1 Create Static Web App

```powershell
.\deploy-frontend-azure.ps1 `
  -SubscriptionId "d33edd77-3a20-49e3-8dbd-93f0344b235e" `
  -ResourceGroup "rg-email-agent" `
  -StaticWebAppName "swa-email-agent" `
  -FunctionsAppUrl "https://func-email-agent-XXXX.azurewebsites.net"
```

### 3.2 Manual Frontend Deployment (Alternative)

```powershell
# Build frontend with production URLs
$env:VITE_FUNCTIONS_BASE_URL = "https://func-email-agent-XXXX.azurewebsites.net"
$env:VITE_API_BASE = "https://func-email-agent-XXXX.azurewebsites.net"
npm run build

# Get deployment token
$SWA_TOKEN = az staticwebapp secrets list `
  --name swa-email-agent `
  --resource-group rg-email-agent `
  --query "properties.apiKey" -o tsv

# Deploy using SWA CLI
npx swa deploy ./dist `
  --deployment-token $SWA_TOKEN `
  --app-location "/" `
  --output-location "dist"
```

### 3.3 Configure Static Web App

**Set environment variables:**
```powershell
az staticwebapp appsettings set `
  --name swa-email-agent `
  --resource-group rg-email-agent `
  --setting-names `
    VITE_FUNCTIONS_BASE_URL="https://func-email-agent-XXXX.azurewebsites.net" `
    VITE_API_BASE="https://func-email-agent-XXXX.azurewebsites.net"
```

---

## 📦 Phase 4: Integration & Testing

### 4.1 Configure CORS

```powershell
az functionapp cors add `
  --name func-email-agent-XXXX `
  --resource-group rg-email-agent `
  --allowed-origins "https://swa-email-agent.azurestaticapps.net"
```

### 4.2 Register Nylas Webhook

```powershell
.\scripts\register-nylas-webhook.ps1 `
  -FuncAppName "func-email-agent-XXXX" `
  -ResourceGroup "rg-email-agent"
```

### 4.3 End-to-End Testing

**Test the complete workflow:**
```powershell
# 1. Trigger backfill
curl -X POST "https://func-email-agent-XXXX.azurewebsites.net/api/sync/backfill" `
  -H "Content-Type: application/json" `
  -d '{"grantId":"your-grant-id","months":1,"max":200}'

# 2. Check job status
curl "https://func-email-agent-XXXX.azurewebsites.net/api/user/jobs?grantId=your-grant-id"

# 3. Test search
curl -X POST "https://func-email-agent-XXXX.azurewebsites.net/api/search" `
  -H "Content-Type: application/json" `
  -d '{"grantId":"your-grant-id","query":"project updates","topK":10}'
```

**Run E2E test suite:**
```powershell
# Update tests to use production URLs
$env:FUNCTIONS_BASE_URL = "https://func-email-agent-XXXX.azurewebsites.net"
npm run test:e2e
```

---

## 📦 Phase 5: Production Hardening

### 5.1 Security Configuration

**Managed identity is already configured** by the setup script.

**Store additional secrets in Key Vault:**
```powershell
# Store any additional secrets
az keyvault secret set --vault-name kv-email-agent-XXXX --name "CUSTOM-SECRET" --value "secret-value"
```

### 5.2 Monitoring & Alerts

**Create alert rules:**
```powershell
# Alert on high error rate
az monitor metrics alert create `
  --name "High Error Rate" `
  --resource-group rg-email-agent `
  --scopes "/subscriptions/.../resourceGroups/rg-email-agent/providers/Microsoft.Web/sites/func-email-agent-XXXX" `
  --condition "count Http5xx > 10" `
  --window-size 5m `
  --evaluation-frequency 1m

# Alert on queue depth
az monitor metrics alert create `
  --name "High Queue Depth" `
  --resource-group rg-email-agent `
  --scopes "/subscriptions/.../resourceGroups/rg-email-agent/providers/Microsoft.ServiceBus/namespaces/sb-email-agent-XXXX/queues/nylas-backfill" `
  --condition "count ActiveMessages > 100" `
  --window-size 5m
```

### 5.3 Scaling Configuration

**Flex Consumption auto-scales** automatically, but you can monitor:

```powershell
# Monitor Function App usage
az monitor app-insights metrics show `
  --app ai-email-agent-XXXX `
  --resource-group rg-email-agent `
  --metric requests/count `
  --interval PT1H
```

---

## 🔧 Monitoring & Troubleshooting

### Common Issues

**1. Function App deployment fails**
```powershell
# Check deployment logs
az functionapp deployment list `
  --name func-email-agent-XXXX `
  --resource-group rg-email-agent

# Verify Node.js version
az functionapp config show `
  --name func-email-agent-XXXX `
  --resource-group rg-email-agent `
  --query "nodeVersion"
```

**2. Service Bus connection errors**
```powershell
# Verify connection string
az functionapp config appsettings list `
  --name func-email-agent-XXXX `
  --resource-group rg-email-agent `
  --query "[?name=='SERVICEBUS_CONNECTION'].value" -o tsv

# Test queue access
az servicebus queue show `
  --name nylas-backfill `
  --namespace-name sb-email-agent-XXXX `
  --resource-group rg-email-agent
```

**3. CORS errors in frontend**
```powershell
# Check CORS settings
az functionapp cors show `
  --name func-email-agent-XXXX `
  --resource-group rg-email-agent

# Add missing origins
az functionapp cors add `
  --name func-email-agent-XXXX `
  --resource-group rg-email-agent `
  --allowed-origins "https://swa-email-agent.azurestaticapps.net"
```

**4. Webhook verification fails**
```powershell
# Check webhook secret
az functionapp config appsettings list `
  --name func-email-agent-XXXX `
  --resource-group rg-email-agent `
  --query "[?name=='NYLAS_WEBHOOK_SECRET'].value" -o tsv
```

### Monitoring Commands

**View logs in real-time:**
```powershell
# Function App logs
az functionapp log tail --name func-email-agent-XXXX --resource-group rg-email-agent

# Application Insights
az monitor app-insights query `
  --app ai-email-agent-XXXX `
  --resource-group rg-email-agent `
  --analytics-query "requests | take 10"
```

---

## 🔄 CI/CD Pipeline

### GitHub Actions Setup

The `.github/workflows/azure-deploy.yml` file provides automated deployment:

**Required GitHub Secrets:**
- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_FUNCTION_APP_NAME`
- `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`
- `AZURE_STATIC_WEB_APP_NAME`
- `AZURE_STATIC_WEB_APPS_API_TOKEN`
- `AZURE_FUNCTION_APP_URL`

**Pipeline Features:**
- ✅ Automatic Functions deployment on push to main
- ✅ Frontend deployment to Static Web App
- ✅ CORS configuration
- ✅ Node.js 22 runtime
- ✅ Remote build optimization

### Manual Deployment Commands

**Deploy Functions only:**
```powershell
cd apps/functions
npm run build
func azure functionapp publish func-email-agent-XXXX --build remote
```

**Deploy Frontend only:**
```powershell
npm run build
npx swa deploy ./dist --deployment-token $SWA_TOKEN
```

---

## 💰 Cost Management

### Monthly Cost Estimation

| Service | Tier | Usage | Est. Cost |
|---------|------|-------|-----------|
| Azure Functions (Flex) | Consumption | ~1M executions, 10GB-s | $5-15 |
| Service Bus | Standard | 1 queue, 10K msgs/day | $10 |
| Storage Account | Standard LRS | 1GB | $0.02 |
| Application Insights | Pay-as-you-go | 5GB/month | $10 |
| Static Web App | Free | <100GB bandwidth | $0 |
| **Total Azure** | | | **~$25-35/month** |

**External services:**
- OpenAI API: ~$20-50/month (depends on usage)
- Pinecone: $70/month (Starter plan)
- Nylas: Free tier or $9/month

**Total estimated cost: $115-165/month**

### Cost Optimization Tips

1. **Enable consumption-based scaling** - already configured
2. **Monitor Function execution count** - set alerts for unexpected spikes
3. **Use Application Insights wisely** - configure sampling if needed
4. **Review Service Bus pricing** - consider Standard vs Premium based on volume

---

## 📝 Quick Start Summary

### One-Command Deployment

```powershell
# 1. Deploy infrastructure
.\deploy-azure.ps1

# 2. Configure app settings (script auto-detects resource names)
.\configure-app-settings.ps1

# 3. Deploy Functions
cd apps/functions
func azure functionapp publish func-email-agent-XXXX --build remote

# 4. Deploy Frontend
cd ../..
.\deploy-frontend-azure.ps1 -FunctionsAppUrl "https://func-email-agent-XXXX.azurewebsites.net"

# 5. Register webhook
.\scripts\register-nylas-webhook.ps1 -FuncAppName "func-email-agent-XXXX"

# 6. Test
npm run test:e2e
```

### Verification Checklist

- [ ] All Azure resources created successfully
- [ ] Function App deployed with all 14 functions
- [ ] Service Bus queue processing backfill jobs
- [ ] Static Web App serving frontend
- [ ] CORS configured correctly
- [ ] Nylas webhook registered and verified
- [ ] Application Insights collecting telemetry
- [ ] E2E tests passing
- [ ] Monitoring alerts configured

---

## 🆘 Support & Troubleshooting

### Getting Help

1. **Check the logs:** Use `az functionapp log tail` for real-time logs
2. **Verify configuration:** Ensure all environment variables are set correctly
3. **Test locally:** Run the same operations locally to isolate issues
4. **Check Azure status:** Verify Azure services are operational in your region

### Common Debugging Commands

```powershell
# Check Function App health
az functionapp show --name func-email-agent-XXXX --resource-group rg-email-agent

# Test Service Bus connectivity
az servicebus queue show --name nylas-backfill --namespace-name sb-email-agent-XXXX --resource-group rg-email-agent

# Verify Key Vault access
az keyvault secret show --vault-name kv-email-agent-XXXX --name "OPENAI-API-KEY"

# Check Static Web App deployment
az staticwebapp show --name swa-email-agent --resource-group rg-email-agent
```

---

## 📚 Additional Resources

- [Azure Functions Documentation](https://learn.microsoft.com/en-us/azure/azure-functions/)
- [Azure Static Web Apps Documentation](https://learn.microsoft.com/en-us/azure/static-web-apps/)
- [Azure Service Bus Documentation](https://learn.microsoft.com/en-us/azure/service-bus-messaging/)
- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime)
- [Pinecone Documentation](https://docs.pinecone.io/)
- [Nylas API v3](https://developer.nylas.com/docs/v3/)

---

**🎉 Congratulations!** Your Real-Time Voice Email Agent is now deployed to Azure and ready for production use.
