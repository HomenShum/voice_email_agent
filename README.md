# Real-Time Voice Email Agent

A full-stack voice assistant for email management using OpenAI's Realtime API, Nylas email integration, and Pinecone vector search.

## 🎯 Overview

This project implements a production-ready voice agent that allows users to search, analyze, and manage emails through natural language voice commands. The system processes 10,000+ emails with semantic search, hierarchical summarization, and real-time updates.

### Key Features

- **Voice Interaction**: Real-time voice chat using OpenAI's gpt-realtime model
- **Email Search**: Semantic vector search over 10,000+ emails with Pinecone
- **Smart Summarization**: Hierarchical rollups (message → thread → day → week → month)
- **Live Updates**: Azure Service Bus + Functions for real-time email processing
- **Multi-tenant**: Per-grant session management with Azure Service Bus sessions
- **Production-Ready**: Application Insights monitoring, webhook verification, exponential backoff

## 📸 Screenshots

### Pinecone Interface
![Pinecone UI](image/Screenshot%202025-10-25%20175805.png)
*Email storage and search capabilities*

### Example Search Results
![Email Search](image/Screenshot%202025-10-25%20175903.png)
*Semantic search results with metadata and relevance scoring*

### System Dashboard
![Dashboard](image/Screenshot%202025-10-25%20182702.png)
*Email metrics and system status monitoring*

## 📊 Current Status

### ✅ Completed
- 10,000 emails indexed in Pinecone with correct metadata
- Local server fully functional (http://localhost:8787)
- Voice agent UI with real-time transcription
- Email metrics dashboard (total count + top 10 results)
- Metadata issue fixed (`type: 'message'` field added)
- `/email/count` endpoint implemented
- Backfill limit increased to 100,000 emails

### ⏳ Pending
- Azure deployment (subscription access issue)
- Storage account and Function App creation
- Service Bus queue configuration
- Webhook registration with Nylas

## 🏗️ Architecture

### Local Development
```
Frontend (Vite + TypeScript)
    ↓
Voice Agent (OpenAI Realtime API)
    ↓
Tools (search_emails, list_contacts, etc.)
    ↓
Backend Server (Node.js)
    ├─ /email/search → Pinecone vector search
    ├─ /email/count → Precise email count
    ├─ /sync/backfill → Manual backfill trigger
    └─ /nylas/* → Nylas API proxy
```

### Azure Production (Planned)
```
Frontend (Static Web App)
    ↓
Voice Agent (OpenAI Realtime API)
    ↓
Azure Functions
    ├─ HTTP Triggers
    │  ├─ /api/sync/delta (manual delta sync)
    │  ├─ /api/webhooks/nylas (webhook handler)
    │  └─ /api/search (email search)
    │
    ├─ Timer Trigger (hourly)
    │  └─ Enqueue delta jobs to Service Bus
    │
    └─ Service Bus Queue Worker
       ├─ Processes backfill/delta jobs
       ├─ Updates Pinecone vectors
       └─ Updates checkpoint per grant
```

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Azure CLI (for deployment)
- OpenAI API key
- Nylas API key + Grant ID
- Pinecone API key + Index

### Installation

```bash
# Install dependencies
npm install

# Install Functions dependencies
cd apps/functions
npm install
cd ../..
```

### Environment Setup

Create `.env` file in project root:

```env
OPENAI_API_KEY=sk-proj-...
EMBEDDING_MODEL=text-embedding-3-small
PINECONE_API_KEY=pcsk_...
PINECONE_INDEX_HOST=https://emails-....pinecone.io
PORT=8787

NYLAS_API_KEY=nyk_v0_...
NYLAS_GRANT_ID=22dd5c25-157e-4377-af23-e06602fdfcec

SERVICEBUS_CONNECTION=Endpoint=sb://...
SB_QUEUE_BACKFILL=nylas-backfill
```

### Running Locally

```bash
# Start backend server
npm run server

# In another terminal, start frontend
npm run dev

# Test backfill (10k emails)
node test-backfill-10k.js

# Test email count
node test-endpoints.js
```

## 📁 Project Structure

```
├── src/                      # Frontend (Vite + TypeScript)
│   ├── main.ts              # Entry point + UI setup
│   ├── lib/
│   │   ├── voiceAgent.ts    # RealtimeAgent + RealtimeSession
│   │   ├── tools.ts         # Tool definitions (search, contacts, etc.)
│   │   └── emailApi.ts      # API client helpers
│   └── style.css
│
├── server/                   # Backend (Node.js ESM)
│   ├── server.js            # HTTP server + endpoints
│   ├── nylasClient.js       # Nylas v3 REST client
│   ├── nylasConfig.js       # Multi-tenant grant management
│   ├── embedding.js         # OpenAI embeddings
│   └── pineconeClient.js    # Pinecone REST client
│
├── apps/functions/           # Azure Functions (Node v4)
│   ├── functions/
│   │   ├── backfillStart.ts # HTTP: POST /api/sync/backfill
│   │   ├── deltaStart.ts    # HTTP: POST /api/sync/delta
│   │   ├── deltaTimer.ts    # Timer: hourly delta sync
│   │   ├── nylasWebhook.ts  # HTTP: Nylas webhook handler
│   │   └── backfillWorker.ts# Service Bus queue worker
│   └── shared/
│       ├── bus.ts           # Service Bus client
│       ├── nylas.ts         # Nylas API client
│       ├── openai.ts        # OpenAI client (embeddings + summarization)
│       ├── pinecone.ts      # Pinecone client
│       ├── storage.ts       # Local storage + checkpoints
│       └── shard.ts         # Time shard helpers
│
└── tests/                    # E2E tests
    ├── cases.mjs            # Test scenarios
    ├── judge.mjs            # LLM judge
    └── run.mjs              # Test runner
```

## 🔧 API Endpoints

### Backend Server (Local)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/realtime/session` | POST | Mint ephemeral OpenAI key |
| `/email/search` | POST | Vector search with filters |
| `/email/count` | POST | Precise email count |
| `/sync/backfill` | POST | Manual backfill trigger |
| `/nylas/contacts` | GET | List contacts |
| `/nylas/events` | GET | List calendar events |
| `/nylas/unread` | GET | List unread messages |

### Azure Functions (Production)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sync/backfill` | POST | Enqueue backfill job |
| `/api/sync/delta` | POST | Enqueue delta sync job |
| `/api/webhooks/nylas` | POST | Nylas webhook handler |
| Timer (hourly) | - | Auto-enqueue delta per grant |

## 🎤 Voice Agent Tools

The voice agent supports the following tools:

- **search_emails**: Semantic search over emails
- **list_contacts**: List Nylas contacts
- **list_events**: List calendar events
- **list_unread_messages**: List unread emails
- **backfill_start**: Trigger manual backfill

## 📊 Vector Database Schema

### Metadata Fields
```typescript
{
  type: 'message' | 'thread' | 'thread_day' | 'thread_week' | 'thread_month',
  grant_id: string,
  email_id: string,
  thread_id: string,
  subject: string,
  from: string,
  from_domain: string,
  to: string[],
  date: number,           // Unix epoch seconds
  date_created: string,   // ISO 8601
  snippet: string,
  has_attachments: boolean,
  unread: boolean,
  bucket?: string         // YYYY-MM-DD | YYYY-Www | YYYY-MM
}
```

## 🔐 Security

### API Key Protection

**CRITICAL**: Never commit API keys to version control!

✅ **Protected Files** (already in `.gitignore`):
- `.env` - Contains all API keys and secrets
- `.env.local` - Local environment overrides
- `apps/functions/local.settings.json` - Azure Functions local settings

✅ **Safe to Commit**:
- `.env.example` - Template with placeholder values
- `configure-app-settings.ps1` - Reads from `.env`, doesn't contain secrets

### Before First Git Commit

```bash
# 1. Verify .gitignore is protecting secrets
git status

# .env and local.settings.json should NOT appear in "Changes to be committed"
# They should be ignored

# 2. Copy .env.example for other developers
# Other developers should copy .env.example to .env and fill in their keys

# 3. Safe to commit
git add .
git commit -m "Initial commit"
git push
```

### If You Accidentally Committed Secrets

**Immediately rotate ALL API keys**:
1. OpenAI: https://platform.openai.com/api-keys
2. Pinecone: https://app.pinecone.io/
3. Nylas: https://dashboard.nylas.com/
4. Azure Service Bus: Regenerate in Azure Portal

Then remove from git history:
```bash
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env apps/functions/local.settings.json" \
  --prune-empty --tag-name-filter cat -- --all

git push origin --force --all
```

### Production Security

- **Webhook Verification**: HMAC-SHA256 signature validation
- **Session Management**: Per-grant Service Bus sessions
- **API Keys**: Stored in Azure Function App settings (encrypted at rest)
- **CORS**: Configured for local dev (tighten for production)
- **HTTPS Only**: All production endpoints use TLS 1.2+

## 📈 Performance

| Metric | Value |
|--------|-------|
| Emails Indexed | 10,000 |
| Search Latency | <100ms |
| Backfill Time | ~290s (51 pages) |
| Embedding Model | text-embedding-3-small (1536 dims) |
| Vector DB | Pinecone Serverless |

## 🧪 Testing

```bash
# Test email search endpoint
node test-endpoints.js

# Test 10k backfill
node test-backfill-10k.js

# Run E2E tests
cd tests
node run.mjs
```

## 📚 Documentation

- **DESIGN_SPECS.md**: Architecture and design decisions
- **FOLDER_STRUCTURES.md**: Detailed folder structure
- **DEPLOYMENT_STATUS.md**: Current deployment status
- **AZURE_DEPLOYMENT.md**: Azure deployment guide (when ready)

## 🛠️ Development

### Build Frontend
```bash
npm run build
```

### Build Functions
```bash
cd apps/functions
npm run build
```

### Local Functions Testing
```bash
cd apps/functions
func start
```

## 🚢 Azure Deployment

### Prerequisites
- Azure CLI installed and authenticated (`az login`)
- Active Azure subscription
- `.env` file configured with all API keys (see `.env.example`)

### Step 1: Create Azure Resources

```bash
# Set variables
$RESOURCE_GROUP = "rg-email-agent"
$LOCATION = "eastus"
$STORAGE_ACCOUNT = "stemailagent$(Get-Random -Minimum 1000 -Maximum 9999)"
$SERVICEBUS_NAMESPACE = "sb-email-agent-$(Get-Random -Minimum 1000 -Maximum 9999)"
$FUNCTION_APP = "func-email-agent-$(Get-Random -Minimum 1000 -Maximum 9999)"
$QUEUE_NAME = "nylas-backfill"

# Create resource group
az group create --name $RESOURCE_GROUP --location $LOCATION

# Create storage account
az storage account create `
  --name $STORAGE_ACCOUNT `
  --resource-group $RESOURCE_GROUP `
  --location $LOCATION `
  --sku Standard_LRS

# Create Service Bus namespace
az servicebus namespace create `
  --name $SERVICEBUS_NAMESPACE `
  --resource-group $RESOURCE_GROUP `
  --location $LOCATION `
  --sku Standard

# Create Service Bus queue with sessions enabled
az servicebus queue create `
  --name $QUEUE_NAME `
  --namespace-name $SERVICEBUS_NAMESPACE `
  --resource-group $RESOURCE_GROUP `
  --enable-session true `
  --max-delivery-count 10

# Create Function App
az functionapp create `
  --name $FUNCTION_APP `
  --resource-group $RESOURCE_GROUP `
  --storage-account $STORAGE_ACCOUNT `
  --consumption-plan-location $LOCATION `
  --runtime node `
  --runtime-version 20 `
  --functions-version 4

# (Optional) Create Application Insights
az monitor app-insights component create `
  --app $FUNCTION_APP `
  --location $LOCATION `
  --resource-group $RESOURCE_GROUP
```

### Step 2: Configure Function App Settings

Use the provided PowerShell script to configure all environment variables:

```bash
# Update parameters in configure-app-settings.ps1 with your resource names
.\configure-app-settings.ps1 `
  -FuncAppName $FUNCTION_APP `
  -ResourceGroup $RESOURCE_GROUP `
  -SbNamespace $SERVICEBUS_NAMESPACE `
  -QueueName $QUEUE_NAME
```

This script will:
- Load API keys from your local `.env` file
- Retrieve Service Bus connection string from Azure
- Configure all Function App settings (OPENAI_API_KEY, NYLAS_API_KEY, etc.)
- Set up Application Insights if available

### Step 3: Build and Deploy Functions

```bash
# Build the Functions app
cd apps/functions
npm install
npm run build

# Deploy to Azure
func azure functionapp publish $FUNCTION_APP

# Verify deployment
az functionapp function list --name $FUNCTION_APP --resource-group $RESOURCE_GROUP
```

### Step 4: Test Deployment

```bash
# Get Function App URL
$FUNC_URL = az functionapp show --name $FUNCTION_APP --resource-group $RESOURCE_GROUP --query defaultHostName -o tsv

# Test backfill endpoint
curl -X POST "https://$FUNC_URL/api/sync/backfill" `
  -H "Content-Type: application/json" `
  -d '{"grantId": "your-grant-id", "months": 1, "max": 200}'

# Check Service Bus queue
az servicebus queue show `
  --name $QUEUE_NAME `
  --namespace-name $SERVICEBUS_NAMESPACE `
  --resource-group $RESOURCE_GROUP `
  --query "countDetails"
```

### Step 5: Register Nylas Webhook

```bash
# Get webhook URL
$WEBHOOK_URL = "https://$FUNC_URL/api/webhooks/nylas"

# Register webhook with Nylas (use Nylas Dashboard or API)
# Webhook URL: $WEBHOOK_URL
# Events: message.created, message.updated
# Webhook Secret: Set NYLAS_WEBHOOK_SECRET in Function App settings
```

### Step 6: Monitor Deployment

```bash
# View Function App logs
az functionapp log tail --name $FUNCTION_APP --resource-group $RESOURCE_GROUP

# View Application Insights metrics (if configured)
az monitor app-insights metrics show `
  --app $FUNCTION_APP `
  --resource-group $RESOURCE_GROUP `
  --metric requests/count
```

### Azure Resources Summary

| Resource | Purpose |
|----------|---------|
| **Resource Group** | Container for all resources |
| **Storage Account** | Azure Functions runtime storage |
| **Service Bus Namespace** | Message queue infrastructure |
| **Service Bus Queue** | Backfill/delta job queue (sessions enabled) |
| **Function App** | Serverless compute for email processing |
| **Application Insights** | Monitoring and diagnostics (optional) |

### Environment Variables (Function App)

The following settings are configured via `configure-app-settings.ps1`:

```
SERVICEBUS_CONNECTION       # Auto-retrieved from Azure
SB_QUEUE_BACKFILL          # Queue name (nylas-backfill)
NYLAS_API_KEY              # From .env
NYLAS_GRANT_ID             # From .env
NYLAS_BASE                 # https://api.us.nylas.com/v3
OPENAI_API_KEY             # From .env
OPENAI_EMBED_MODEL         # text-embedding-3-small
OPENAI_TEXT_MODEL          # gpt-5-mini
PINECONE_API_KEY           # From .env
PINECONE_INDEX_NAME        # emails
PINECONE_INDEX_HOST        # From .env
NYLAS_WEBHOOK_SECRET       # dev (change for production)
DELTA_DEFAULT_MONTHS       # 1
DELTA_MAX                  # 100000
```

### Troubleshooting Deployment

#### Azure CLI Authentication
```bash
# Re-authenticate if token expired
az login

# Verify subscription
az account show
```

#### Function App Not Starting
```bash
# Check Function App status
az functionapp show --name $FUNCTION_APP --resource-group $RESOURCE_GROUP --query state

# Restart Function App
az functionapp restart --name $FUNCTION_APP --resource-group $RESOURCE_GROUP
```

#### Service Bus Connection Issues
```bash
# Verify queue exists
az servicebus queue show --name $QUEUE_NAME --namespace-name $SERVICEBUS_NAMESPACE --resource-group $RESOURCE_GROUP

# Check connection string
az servicebus namespace authorization-rule keys list `
  --name RootManageSharedAccessKey `
  --namespace-name $SERVICEBUS_NAMESPACE `
  --resource-group $RESOURCE_GROUP
```

See `DEPLOYMENT_STATUS.md` for detailed deployment progress and status.

## 🐛 Troubleshooting

### "past 30 days" returns 0 results
**Fixed**: Added `type: 'message'` metadata field to all vectors

### .env not loading
**Fixed**: Moved dotenv loading to top of server.js with explicit path

### Azure subscription access
**Issue**: Refresh token expired. Re-authenticate with `az login`

## 📝 License

MIT

## 👥 Contributors

- Homen Shum (hshum2018@gmail.com)

## 🙏 Acknowledgments

- OpenAI Realtime API
- Nylas Email API
- Pinecone Vector Database
- Azure Functions

