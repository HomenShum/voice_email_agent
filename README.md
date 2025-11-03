# Real-Time Voice Email Agent

A full-stack voice assistant for email management using OpenAI's Realtime API, Nylas email integration, and Pinecone vector search.

## 🚀 Live Deployment

- **Frontend UI**: https://orange-mud-087b3a60f.3.azurestaticapps.net
- **Functions API**: https://func-email-agent-9956-lx.azurewebsites.net
- **API Endpoints**:
  - `/api/nylas/unread` — List unread emails
  - `/api/nylas/contacts` — List contacts
  - `/api/nylas/events` — List calendar events
  - `/api/search` — Semantic email search
  - `/api/aggregate` — Email aggregation
  - `/api/realtime/session` — OpenAI Realtime session
  - `/api/sync/delta` — Delta sync trigger

## 🎯 Overview

This project implements a production-ready voice agent that allows users to search, analyze, and manage emails through natural language voice commands. The system processes 10,000+ emails with semantic search, hierarchical summarization, and real-time updates.

### Key Features

- **Voice Interaction**: Real-time voice chat using OpenAI's gpt-5-mini model
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
- ✅ 10,000+ emails indexed in Pinecone with correct metadata
- ✅ Local server fully functional (http://localhost:8787)
- ✅ Voice agent UI with real-time transcription
- ✅ Email metrics dashboard (total count + top 10 results)
- ✅ Metadata issue fixed (`type: 'message'` field added)
- ✅ Delta sync window constrained to the latest 10,000 emails (dense + sparse vectors)
- ✅ **Azure Functions deployed** (`func-email-agent-9956-lx`)
- ✅ **Static Web App deployed** (orange-mud-087b3a60f.3.azurestaticapps.net)
- ✅ **Service Bus configured** (sb-email-agent-9085 with nylas-backfill queue)
- ✅ **All endpoints tested and working** (200/400 status codes as expected)
- ✅ **GitHub Actions CI/CD pipeline** (automated deployment on push)
- ✅ **CORS configured** between Static Web App and Functions

### ⏳ Pending
- Webhook registration with Nylas (optional - for real-time sync)
- Production security hardening (CORS restrictions, API key rotation)

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

### Azure Production (✅ Live)
```
Frontend (Static Web App) ✅
    ↓
Voice Agent (OpenAI Realtime API) ✅
    ↓
Azure Functions (func-email-agent-9956-lx) ✅
    ├─ HTTP Triggers ✅
    │  ├─ /api/nylas/unread (list unread emails)
    │  ├─ /api/nylas/contacts (list contacts)
    │  ├─ /api/nylas/events (list calendar events)
    │  ├─ /api/sync/delta (manual delta sync)
    │  ├─ /api/search (semantic email search)
    │  ├─ /api/aggregate (email aggregation)
    │  └─ /api/realtime/session (OpenAI session)
    │
    ├─ Timer Trigger (hourly) ✅
    │  └─ Enqueue delta jobs to Service Bus
    │
    └─ Service Bus Queue Worker ✅
       ├─ Processes backfill/delta jobs
       ├─ Updates Pinecone vectors
       └─ Updates checkpoint per grant
```
## 🧭 Full‑Stack Workflow (ASCII)

This section maps the entire system end‑to‑end across UI, local server, and Azure Functions, including email ingestion, preprocessing (metadata + dense/sparse vectors), retrieval, agent orchestration, and testing.

### High‑Level (Dev + Prod)
```
[Browser UI]
   |\
   | \--(Dev)--> [Local Server (8787)] -- /nylas/*, /email/search|aggregate|count, /api/realtime/session
   |            \-> [Pinecone (REST)]
   |
   \--(Dev & Prod)--> [Azure Functions (7071/7072 or Cloud)]
                      - HTTP: /api/user/update-context, /api/sync/delta, /api/search, /api/aggregate,
                              /api/user/delete, /api/user/sync-progress/:jobId, /api/user/jobs
                      - Timer: deltaTimer (hourly/minutely dev)
                      - Queue Worker: backfillWorker (Service Bus sessions)
                              |
                              v
                          [Pinecone SDK]
```

Notes:
- UI calls both the Local Server (dev conveniences) and Azure Functions (core pipeline).
- In production you may disable Local Server and rely solely on Functions.

### Email Pulling → Queue → Worker (Azure Functions)
```
(updateContext | deltaStart | deltaTimer)
        |  (create JobRecord per grant)
        v
   [Service Bus Queue]  (sessionId = grantId)
        |
        v
   [backfillWorker]
      |-- listMessages(grantId, received_after=checkpoint)
      |-- For each message:
      |     - Clean/sanitize HTML → text
      |     - Download + analyze attachments (image/pdf heuristics)
      |     - Summarize (map-reduce) → message/thread/day/week/month
      |     - Embed summaries/text (dense)
      |     - Build metadata (see below)
      |-- Upsert vectors to Pinecone (message + summaries)
      |-- setCheckpoint(max(message.date)) per page
      |-- updateJob(processed, indexedVectors, status)
```

Key files: functions/updateContext.ts, deltaStart.ts, deltaTimer.ts, backfillWorker.ts, shared/nylas.ts, shared/openai.ts, shared/pinecone.ts, shared/storage.ts

### Metadata Preprocessing (stored in Pinecone metadata)
- Common:
  - type: "message" | "thread" | "thread_day" | "thread_week" | "thread_month"
  - grant_id, email_id, thread_id
  - subject, from, from_domain, to[]
  - date (epoch) and date_created (ISO)
  - labels[], folder
  - has_attachments, attachment_count, attachment_types[]
  - snippet (summary excerpt)
  - day_key | week_key | month_key (for rollups);
  - summary_scope for rollup vectors

### Dense Vector Pipeline (Implemented)
```
[text] -> embedText (OpenAI text-embedding-3-small) -> { id, values: float[], metadata } -> Pinecone upsert
[query] -> embedText -> Pinecone query(topK, filter) -> matches
```
- Functions endpoints: POST /api/search, POST /api/aggregate
- Local server endpoints: POST /email/search, POST /email/aggregate (REST Pinecone)

### Hybrid Dense + Sparse Pipeline (Implemented)
```
[text] -> embedText (OpenAI text-embedding-3-small) + generateSparseEmbedding (pinecone-sparse-english-v0)
       -> upsertDenseVectors + upsertSparseRecords (separate indexes)
[query] -> embedText + generateSparseEmbedding -> hybridQuery (dense + sparse)
       -> RRF/weighted fusion -> matches (score, source, metadata)
```
- Functions & local server share helpers in `shared/pinecone.ts`.
- Requires `PINECONE_DENSE_INDEX_NAME` (or legacy `PINECONE_INDEX_NAME`) and `PINECONE_SPARSE_INDEX_NAME`.
- Based on Pinecone hybrid search docs (dense + sparse + RRF).

### Retrieval & Search / Aggregation
```
POST /api/search (Functions)
  - embed query
  - build filter (types, thread_id, bucket, date range)
  - ns.query({ vector, topK, includeMetadata: true, filter })
  - return matches (metadata massaged)

POST /api/aggregate (Functions)
  - embed query
  - ns.query(sample topK)
  - group counts by from_domain | thread_id | custom key
```
Local server mirrors similar endpoints via Pinecone REST.

### Agent Orchestration (Realtime Voice)
```
UI -> POST /api/realtime/session (Local Server)
      -> obtains ephemeral client_secret for OpenAI Realtime
UI <-> OpenAI Realtime (gpt-5-mini):
      - Uses tools to call:
          • /email/search | /email/aggregate | /nylas/* (Local)
          • /api/search   | /api/aggregate    (Functions)
      - Streams final response (text/audio)
```

### E2E Tests + Judge
```
/tests/run.mjs
  - For each case (tests/cases.mjs):
      • POST /api/search (Functions)
      • POST /api/aggregate (Functions)
      • Snapshot results to tests/results/*.json
      • Judge via tests/judge.mjs (OPENAI_JUDGE_MODEL=gpt-5)
      • Summary with pass/fail gate
```

References (validated against official docs):
- Azure Functions Timer trigger (6-field cron with seconds): https://learn.microsoft.com/azure/azure-functions/functions-bindings-timer
- Nylas v3 Messages: https://developer.nylas.com/docs/api/v3/ecc/
- Pinecone Hybrid Search (sparse+dense): https://www.pinecone.io/learn/hybrid-search-intro/


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
| `/api/search` | POST | Semantic email search (Pinecone) |
| `/api/aggregate` | POST | Email aggregation (Pinecone) |
| `/api/nylas/unread` | GET | List unread messages (Nylas) |
| `/api/nylas/contacts` | GET | List contacts (Nylas) |
| `/api/nylas/events` | GET | List calendar events (Nylas) |
| `/api/sync/backfill` | POST | Enqueue backfill job |
| `/api/sync/delta` | POST | Enqueue delta sync job |
| `/api/webhooks/nylas` | POST | Nylas webhook handler |
| `/api/realtime/session` | POST | Mint ephemeral OpenAI key |
| Timer (hourly) | - | Auto-enqueue delta per grant |



## 🎤 Voice Agent Architecture

### Client-Side Router + Specialists

The voice agent uses a **client-side router + specialists pattern** where all orchestration happens in the browser:

**Router Agent (gpt-realtime):**
- Analyzes user intent from voice input
- Delegates to the appropriate specialist using OpenAI Agents SDK handoffs
- Provides real-time voice narration

**Specialist Agents (gpt-realtime):**
- **EmailOpsAgent**: Email search, triage, unread messages
  - Tools: `search_emails`, `triage_recent_emails`, `list_unread_messages`, `list_recent_emails`
- **InsightAgent**: Email analytics and aggregations
  - Tools: `aggregate_emails`, `search_emails` (for summaries)
- **ContactsAgent**: Contact lookup via Nylas
  - Tools: `list_contacts`
- **CalendarAgent**: Calendar events via Nylas
  - Tools: `list_events`
- **AutomationAgent**: Automation capabilities
  - Tools: (future: draft emails, schedule sends)

### Available Tools

All tools call secure Azure Functions endpoints that handle authentication:

- **search_emails**: Semantic search over emails (calls `/api/search`)
- **aggregate_emails**: Email aggregation and analytics (calls `/api/aggregate`)
- **triage_recent_emails**: LLM-powered email prioritization (calls `/api/nylas/unread`)
- **list_recent_emails**: Fetch latest messages (calls `/api/nylas/unread`)
- **list_contacts**: List Nylas contacts (calls `/api/nylas/contacts`)
- **list_events**: List calendar events (calls `/api/nylas/events`)
- **list_unread_messages**: List unread emails (calls `/api/nylas/unread`)
- **sync_start**: Trigger delta sync (calls `/api/sync/delta`)
- **backfill_start**: Trigger manual backfill (calls `/api/sync/backfill`)

### Why Client-Side Router?

**Architecture:**
```
User Voice → Client Router (gpt-realtime) → Client Specialists (gpt-realtime) → Tool Endpoints → Results
```

**Benefits:**
- ✅ **Lower latency** - Routing decisions happen instantly in the browser
- ✅ **Better real-time experience** - No network round-trip for routing
- ✅ **Reduced costs** - No backend gpt-5-mini usage for routing
- ✅ **Voice-first design** - Direct handoffs between realtime agents
- ✅ **Secure** - All API keys stay on server-side tool endpoints

**Key Insight:** Since all tools are already deployed as individual API endpoints (`/api/search`, `/api/aggregate`, etc.) that handle authentication and secrets, the client-side router can call these endpoints directly, providing a faster and more cost-effective solution.

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

## ⏱ Local Hourly Verification (dev-mode every minute)

When developing locally, you may want to see a run every minute instead of every hour. Azure Functions timer triggers use a six-field NCRONTAB expression (seconds first). Changing the schedule to "0 * * * * *" triggers once per minute.

### 1) Change the timer schedule (local only)
Update `apps/functions/functions/deltaTimer.ts` schedule line:

```ts
schedule: "0 * * * * *", // every minute (local dev)
```

Revert to hourly when done:

```ts
schedule: "0 0 * * * *", // top of every hour
```

### 2) Build and run Functions with timer enabled
```powershell
cd apps/functions
npm run build
$env:SKIP_TIMER=""; npx func start --port 7072 --verbose
```
The Functions host should print the next 5 occurrences of the schedule. (Core Tools handle timer scheduling locally; Azurite is recommended but not strictly required for the timer.)

### 3) Point the frontend to the timer host
Start (or restart) the frontend with the Functions base set to 7072 so the UI can show the latest hourly/minutely runs:
```powershell
$env:VITE_FUNCTIONS_BASE_URL='http://localhost:7072'; npm run dev
```

### 4) Verify in the UI (Hourly Sync History)
- Open http://localhost:5175
- Enter your Nylas API Key + Grant ID, click “Update Voice Agent Context”
- Watch the “Hourly Sync History” panel update every minute with:
  - status, processed messages, and vectors indexed

### 5) Verify via REST
```bash
curl "http://localhost:7072/api/user/jobs?grantId=<YOUR_GRANT_ID>&limit=10"
```
Returns `{ ok: true, jobs: [...] }` sorted newest first.

### 6) Visualization: Hourly/Minutely sync flow
```mermaid
flowchart TD
  T[deltaTimer (schedule)] --> Q[enqueueBackfill → Azure Service Bus]
  Q --> W[backfillWorker]
  W --> P[Upsert vectors → Pinecone]
  W --> J[Update JobRecord → .data/jobs/<jobId>.json]
  J --> E[GET /api/user/jobs]
  E --> UI[Frontend “Hourly Sync History”]
```

References: Azure Functions Timer trigger docs (Node v4 model, six-field schedule): https://learn.microsoft.com/azure/azure-functions/functions-bindings-timer

## 🚢 Azure Deployment & CI/CD Pipeline

### ✅ Current Deployment Status (11/2/2025)

**All resources are deployed and live!** The application is running on:
- **Function App**: `func-email-agent-9956-lx` (Linux Consumption plan)
- **Service Bus**: `sb-email-agent-9085` with queue `nylas-backfill`
- **Static Web App**: `orange-mud-087b3a60f.3.azurestaticapps.net`

### Deployment & CI/CD Workflow

We are able to deploy Azure Function here in order to update the Azure Function server side changes. If we do a full `git add`, `git commit`, and `git push`, then there is also a CI/CD pipeline that helps us to deploy Azure Static App and Azure Function App, configure CORS, and then test the API endpoints individually to see if they are returning the proper service code.

### Full-Stack Multi-Agent Architecture: Client-Side Router + Specialists

**Architecture Overview:**
The system uses a **client-side router + specialists pattern** where all agent orchestration happens locally in the browser using OpenAI's Realtime API (gpt-realtime). The backend provides secure tool endpoints that the agents call directly.

**Client-Side Architecture (Browser):**
- **Voice Input**: User speaks to the voice agent (gpt-realtime)
- **Router Agent**: Analyzes user intent and delegates to the appropriate specialist using OpenAI Agents SDK handoffs
- **Specialist Agents** (all running gpt-realtime with handoffs):
  - **EmailOpsAgent**: Email search, triage, unread messages
  - **InsightAgent**: Email analytics and aggregations
  - **ContactsAgent**: Contact lookup via Nylas
  - **CalendarAgent**: Calendar events via Nylas
  - **AutomationAgent**: Automation capabilities
- **Tool Execution**: Each specialist calls server-side tool endpoints directly (e.g., `/api/search`, `/api/aggregate`, `/api/nylas/unread`)
- **Voice Output**: Real-time narration of progress and results

**Server-Side Architecture (Azure Functions):**
All tools are deployed as individual HTTP endpoints that handle authentication and secrets:
- `/api/search` - Semantic email search (Pinecone)
- `/api/aggregate` - Email aggregation (Pinecone)
- `/api/nylas/unread` - Unread messages (Nylas API)
- `/api/nylas/contacts` - Contacts (Nylas API)
- `/api/nylas/events` - Calendar events (Nylas API)
- `/api/sync/delta` - Delta sync trigger
- `/api/sync/backfill` - Backfill trigger

**Key Benefits:**
1. ✅ **Lower latency** - Routing decisions happen instantly in the browser
2. ✅ **Better real-time experience** - No network round-trip for routing
3. ✅ **Reduced costs** - No backend gpt-5-mini usage for routing
4. ✅ **Voice-first design** - Direct handoffs between realtime agents
5. ✅ **Secure** - All API keys and secrets stay on server-side tool endpoints

**Request Flow:**
```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (Client)                        │
│                                                                 │
│  User Voice Input                                               │
│       ↓                                                         │
│  Router Agent (gpt-realtime)                                    │
│       ↓ (analyzes intent, uses handoffs)                        │
│  Specialist Agent (gpt-realtime)                                │
│    • EmailOpsAgent                                              │
│    • InsightAgent                                               │
│    • ContactsAgent                                              │
│    • CalendarAgent                                              │
│    • AutomationAgent                                            │
│       ↓ (calls tool endpoint)                                   │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │ HTTPS
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│                   Azure Functions (Server)                      │
│                                                                 │
│  Tool Endpoints (with API key authentication):                  │
│    • /api/search → Pinecone vector search                       │
│    • /api/aggregate → Pinecone aggregation                      │
│    • /api/nylas/unread → Nylas API (unread messages)            │
│    • /api/nylas/contacts → Nylas API (contacts)                 │
│    • /api/nylas/events → Nylas API (calendar events)            │
│    • /api/sync/delta → Service Bus (delta sync)                 │
│    • /api/sync/backfill → Service Bus (backfill)                │
│       ↓                                                         │
│  Results (JSON)                                                 │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │ JSON Response
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (Client)                        │
│                                                                 │
│  Specialist Agent (processes results)                           │
│       ↓                                                         │
│  Router Agent (synthesizes response)                            │
│       ↓                                                         │
│  Voice Output (gpt-realtime TTS)                                │
└─────────────────────────────────────────────────────────────────┘
```

### Prerequisites (for re-deployment or updates)
- Azure CLI installed and authenticated (`az login`)
- Active Azure subscription
- `.env` file configured with all API keys (see `.env.example`)
- GitHub repository with secrets configured

### Current Azure Resources

| Resource | Name | Type | Status |
|----------|------|------|--------|
| **Function App** | `func-email-agent-9956-lx` | Linux Consumption | ✅ Running |
| **Service Bus** | `sb-email-agent-9085` | Standard | ✅ Active |
| **Queue** | `nylas-backfill` | Service Bus Queue | ✅ Active |
| **Storage Account** | `stemail155743` | Standard LRS | ✅ Active |
| **Key Vault** | `kv-email-agent-1396` | Standard | ✅ Active |
| **Static Web App** | `swa-email-agent` | Free | ✅ Active |
| **Application Insights** | `appinsights-email-agent` | Standard | ✅ Active |

**Note**: Unused resources have been cleaned up (6 old Function Apps and 7 old Service Bus namespaces deleted).

### Step 1: Create Azure Resources (if needed)

```bash
# Set variables
$RESOURCE_GROUP = "rg-email-agent"
$LOCATION = "eastus"
$STORAGE_ACCOUNT = "stemailagent$(Get-Random -Minimum 1000 -Maximum 9999)"
$SERVICEBUS_NAMESPACE = "sb-email-agent-$(Get-Random -Minimum 1000 -Maximum 9999)"
$FUNCTION_APP = "func-email-agent-$(Get-Random -Minimum 1000 -Maximum 9999)-lx"
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

# Create Function App (Linux Consumption)
az functionapp create `
  --name $FUNCTION_APP `
  --resource-group $RESOURCE_GROUP `
  --storage-account $STORAGE_ACCOUNT `
  --consumption-plan-location $LOCATION `
  --runtime node `
  --runtime-version 22 `
  --functions-version 4 `
  --os-type Linux

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
DELTA_MAX                  # 10000
DELTA_TIMER_SCHEDULE       # 0 0 * * * *
DELTA_TIMER_RUN_ON_STARTUP # 0 (set 1 locally to force immediate timer fire)
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
