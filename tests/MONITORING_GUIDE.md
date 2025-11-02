# E2E Test Suite - Monitoring & Testing Guide

## 🎯 Overview

This guide covers how to test and monitor:
1. Azure Functions endpoints
2. Pinecone vector database connectivity and index stats
3. E2E test suite execution
4. Tool invocation patterns
5. Test results and regression detection

## 📋 Prerequisites

### Environment Variables Required

```bash
# OpenAI
OPENAI_API_KEY=sk-proj-...
OPENAI_TEXT_MODEL=gpt-5-mini
OPENAI_EMBED_MODEL=text-embedding-3-small

# Pinecone
PINECONE_API_KEY=pcsk_...
PINECONE_INDEX_HOST=https://emails-xxxxx.svc.aped-xxxx-xxxx.pinecone.io
PINECONE_INDEX_NAME=emails
PINECONE_SPARSE_INDEX_NAME=emails-sparse

# Nylas Email API
NYLAS_API_KEY=nyk_v0_...
NYLAS_GRANT_ID=22dd5c25-157e-4377-af23-e06602fdfcec

# Azure Service Bus (for Pinecone verification)
SERVICEBUS_CONNECTION=Endpoint=sb://...
SB_QUEUE_BACKFILL=nylas-backfill

# Azure Functions
FUNCTIONS_BASE=http://localhost:7071  # Local dev
# or
FUNCTIONS_BASE=https://func-email-agent-xxxx.azurewebsites.net  # Production
```

### Check Environment

```bash
# Verify .env file exists
ls -la .env

# Check required variables
grep -E "OPENAI_API_KEY|PINECONE_API_KEY|NYLAS_API_KEY" .env
```

## 🚀 Step 1: Verify Azure Functions

### Option A: Local Development

```bash
# Start dev host (exposes functions on localhost:7071)
node tests/dev-host.cjs

# In another terminal, test endpoints
curl http://localhost:7071/api/index/stats
curl http://localhost:7071/api/health
```

### Option B: Production Deployment

```bash
# Get Function App URL
$FUNC_URL = az functionapp show \
  --name func-email-agent-xxxx \
  --resource-group rg-email-agent \
  --query defaultHostName -o tsv

# Test endpoints
curl "https://$FUNC_URL/api/index/stats"
curl "https://$FUNC_URL/api/health"
```

### Expected Responses

**Health Check** (GET /api/health):
```json
{
  "status": "ok",
  "timestamp": "2025-11-01T12:00:00Z"
}
```

**Index Stats** (GET /api/index/stats):
```json
{
  "session": {
    "dense": {
      "byNamespace": {
        "22dd5c25-157e-4377-af23-e06602fdfcec": {
          "records": 1250,
          "dimension": 1536
        }
      }
    }
  }
}
```

## 🔍 Step 2: Check Pinecone Connectivity

### Test Pinecone API

```bash
# Create a test script
cat > test-pinecone.js << 'EOF'
import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(process.env.PINECONE_INDEX_NAME);

// Get index stats
const stats = await index.describeIndexStats();
console.log('Index Stats:', JSON.stringify(stats, null, 2));

// Check namespace
const ns = process.env.NYLAS_GRANT_ID;
const nsStats = stats.namespaces?.[ns];
console.log(`Namespace ${ns}:`, nsStats);
EOF

node test-pinecone.js
```

### Expected Output

```
Index Stats: {
  "namespaces": {
    "22dd5c25-157e-4377-af23-e06602fdfcec": {
      "recordCount": 1250,
      "vectorCount": 1250
    }
  }
}
```

## 🧪 Step 3: Run E2E Tests

### Basic Test Run

```bash
# Fast mode (skip LLM judge)
JUDGE_DISABLE_LLM=1 npm run test:e2e

# Expected output:
# [security-alert] tools called: search_emails
# [security-alert] pass=true  useful=true  correct=true  regress_changed=false
# ...
# [summary] 9/9 passed
```

### With Tool Verification

```bash
# Enable tool verification
E2E_AGENT_VERIFY=1 JUDGE_DISABLE_LLM=1 npm run test:e2e

# Expected output:
# [security-alert] tools called: search_emails, triage_recent_emails
# [security-alert] tool_verification: passed=true
# ...
```

### With Pinecone Verification

```bash
# Enable Pinecone index tracking
E2E_PINECONE_VERIFY=1 JUDGE_DISABLE_LLM=1 npm run test:e2e

# Expected output:
# [unread-delta] Delta sync enqueued for namespace 22dd5c25-157e-4377-af23-e06602fdfcec
# [unread-delta] Pinecone index increased: 1250 -> 1275 (+25)
# ...
```

### Full Verification

```bash
# All checks enabled
E2E_AGENT_VERIFY=1 E2E_PINECONE_VERIFY=1 JUDGE_DISABLE_LLM=1 npm run test:e2e
```

## 📊 Step 4: Monitor Test Results

### View Latest Results

```bash
# List all test results
ls -lt tests/results/ | head -20

# View latest summary
cat tests/results/summary-*.json | tail -1 | jq '.'

# View specific test result
cat tests/results/security-alert-*.json | tail -1 | jq '.agent.tool_verification'
```

### Analyze Tool Invocations

```bash
# Extract tool events from latest test
cat tests/results/security-alert-*.json | tail -1 | jq '.agent.tool_events[] | {type, toolName, durationMs}'

# Count tool invocations
cat tests/results/security-alert-*.json | tail -1 | jq '[.agent.tool_events[] | select(.type=="tool_started")] | length'
```

### Check Pinecone Changes

```bash
# View index changes for unread-delta test
cat tests/results/unread-delta-*.json | tail -1 | jq '.index_increase'

# Expected output:
# {
#   "before": 1250,
#   "after": 1275,
#   "delta": 25,
#   "increased": true
# }
```

## 🔧 Step 5: Troubleshooting

### Azure Functions Not Responding

```bash
# Check if dev host is running
curl http://localhost:7071/api/health

# If not, start it
node tests/dev-host.cjs

# Check logs
tail -f func-logs/LogFiles/Application/
```

### Pinecone Connection Failed

```bash
# Verify API key
echo $PINECONE_API_KEY

# Test connectivity
curl -X GET "https://api.pinecone.io/indexes" \
  -H "Api-Key: $PINECONE_API_KEY"

# Check index exists
curl -X GET "https://api.pinecone.io/indexes/emails" \
  -H "Api-Key: $PINECONE_API_KEY"
```

### Tests Failing

```bash
# Run with verbose output
DEBUG=* npm run test:e2e

# Check specific test
npm run test:e2e -- --grep "security-alert"

# View detailed snapshot
cat tests/results/security-alert-*.json | jq '.agent'
```

## 📈 Monitoring Checklist

- [ ] Azure Functions endpoints responding (health, index/stats)
- [ ] Pinecone API connectivity verified
- [ ] Index stats showing correct vector counts
- [ ] E2E tests running successfully
- [ ] Tool invocations being captured
- [ ] Tool verification passing
- [ ] Pinecone index changes tracked
- [ ] Test results saved to snapshots
- [ ] No regressions detected

## 🎯 Key Metrics to Track

| Metric | Expected | Location |
|--------|----------|----------|
| Azure Functions Health | 200 OK | `/api/health` |
| Pinecone Index Records | > 0 | `/api/index/stats` |
| E2E Tests Passed | 9/9 | `tests/results/summary-*.json` |
| Tool Invocations | > 0 | `tests/results/{test-id}-*.json` |
| Tool Verification | passed=true | `.agent.tool_verification` |
| Pinecone Delta | > 0 | `.index_increase.delta` |

## 📝 Test Report Template

```markdown
# Test Report - [DATE]

## Environment
- Azure Functions: [URL]
- Pinecone Index: [NAME]
- Nylas Grant: [GRANT_ID]

## Results
- Tests Passed: 9/9
- Tool Verification: ✅ Passed
- Pinecone Tracking: ✅ Passed

## Tool Invocations
- search_emails: 5 calls
- triage_recent_emails: 3 calls
- list_unread_messages: 1 call

## Pinecone Changes
- Before: 1250 records
- After: 1275 records
- Delta: +25 records

## Issues
- None

## Next Steps
- Monitor production deployment
- Track tool performance metrics
```

## 🚀 Automated Monitoring

### Create Monitoring Script

```bash
#!/bin/bash
# monitor.sh - Run tests and generate report

set -e

echo "=== E2E Test Monitoring ==="
echo "Time: $(date)"

# Run tests
E2E_AGENT_VERIFY=1 E2E_PINECONE_VERIFY=1 JUDGE_DISABLE_LLM=1 npm run test:e2e

# Generate report
LATEST=$(ls -t tests/results/summary-*.json | head -1)
echo ""
echo "=== Test Summary ==="
cat "$LATEST" | jq '.results[] | {id, pass: .judge.pass, tools: .agent.tool_verification.called}'

echo ""
echo "=== Pinecone Changes ==="
cat tests/results/unread-delta-*.json | tail -1 | jq '.index_increase'

echo ""
echo "=== Monitoring Complete ==="
```

Run it:
```bash
chmod +x monitor.sh
./monitor.sh
```

## 📞 Support

For issues or questions:
1. Check `QUICK_START.md` for common scenarios
2. Review test snapshots in `tests/results/`
3. Check Azure Functions logs
4. Verify Pinecone connectivity

