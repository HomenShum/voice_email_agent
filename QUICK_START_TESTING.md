# Quick Start: Running E2E Tests

## 1. Start the Dev Host (Terminal 1)

```bash
node tests/dev-host.cjs
```

Expected output:
```
Handlers registered: [
  'agent',
  'search',
  'aggregate',
  'mcp',
  'indexStats',
  'backfillStart',
  'deltaStart'
]
Dev Functions host listening at http://localhost:8787
```

## 2. Run Tests (Terminal 2)

### Option A: Fast Tests (No LLM Judge)
```bash
$env:E2E_AGENT_VERIFY="1"; $env:JUDGE_DISABLE_LLM="1"; npm run test:e2e
```

**Time**: ~2 minutes  
**Output**: Tool invocations verified, snapshots saved

### Option B: Full Tests (With LLM Judge)
```bash
$env:E2E_AGENT_VERIFY="1"; npm run test:e2e
```

**Time**: ~5-10 minutes  
**Output**: Tool invocations + content validation

### Option C: With Pinecone Verification
```bash
$env:E2E_AGENT_VERIFY="1"; $env:E2E_PINECONE_VERIFY="1"; $env:JUDGE_DISABLE_LLM="1"; npm run test:e2e
```

**Time**: ~3-5 minutes  
**Output**: Tool invocations + Pinecone index changes tracked

## 3. View Results

### Latest Summary
```bash
node -e "const fs = require('fs'); const files = fs.readdirSync('tests/results').filter(f => f.startsWith('summary-')).sort().reverse(); const latest = files[0]; console.log(JSON.stringify(JSON.parse(fs.readFileSync('tests/results/' + latest, 'utf8')), null, 2))"
```

### Individual Test Snapshot
```bash
node -e "const fs = require('fs'); const file = 'tests/results/security-alert-2025-11-02T00-07-31-273Z.json'; console.log(JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')), null, 2))"
```

### Tool Events from Test
```bash
node -e "const fs = require('fs'); const file = 'tests/results/security-alert-2025-11-02T00-07-31-273Z.json'; const data = JSON.parse(fs.readFileSync(file, 'utf8')); console.log(JSON.stringify(data.agent.tool_events, null, 2))"
```

## Environment Variables

### Required
- `OPENAI_API_KEY` - For LLM judge (if enabled)
- `PINECONE_API_KEY` - For Pinecone verification
- `NYLAS_API_KEY` - For email API
- `NYLAS_GRANT_ID` - Email account grant ID

### Optional
- `E2E_AGENT_VERIFY=1` - Enable tool verification (default: enabled)
- `E2E_PINECONE_VERIFY=1` - Enable Pinecone index tracking (default: disabled)
- `JUDGE_DISABLE_LLM=1` - Skip LLM judge for speed (default: enabled if OPENAI_API_KEY set)
- `FUNCTIONS_BASE=http://localhost:8787` - Dev host URL (default: http://localhost:7071)

## Troubleshooting

### Tests fail with "Expected agent to invoke at least one tool"
**Cause**: E2E_AGENT_VERIFY not set or dev host not running  
**Fix**: 
```bash
$env:E2E_AGENT_VERIFY="1"
node tests/dev-host.cjs  # In separate terminal
```

### Dev host not responding
**Cause**: Port 8787 already in use or dev host crashed  
**Fix**:
```bash
# Kill existing process
Get-Process node | Stop-Process -Force

# Restart dev host
node tests/dev-host.cjs
```

### Tool events not captured
**Cause**: FUNCTIONS_BASE pointing to wrong URL  
**Fix**: Verify dev host is running on localhost:8787
```bash
curl http://localhost:8787/api/index/stats
```

### System environment variable overriding .env
**Cause**: Windows system environment variable E2E_AGENT_VERIFY=0  
**Fix**: Set in PowerShell before running tests
```bash
$env:E2E_AGENT_VERIFY="1"
```

## Test Cases

| ID | Query | Tools | Status |
|----|-------|-------|--------|
| security-alert | Find the security alert from Google | search_emails | ✅ |
| uc-berkeley-event | Show me the UC Berkeley event email | search_emails, triage_recent_emails | ✅ |
| yelp-prompt | What did Yelp ask me to do recently? | search_emails | ✅ |
| bandsintown | Summarize the Bandsintown update | search_emails | ✅ |
| upwork-job | Summarize the Upwork job alert | search_emails | ✅ |
| rollup-week | Give me the weekly summary | search_emails | ✅ |
| rollup-month | Summarize the monthly highlights | search_emails, triage_recent_emails | ✅ |
| unread-delta | Fetch unread since last run | list_unread_messages | ✅ |
| attachment-summary | Which emails had attachments recently? | search_emails | ✅ |

## Expected Output

```
[collectAgentRun] Calling http://localhost:8787/api/agent with grantId=...
[collectAgentRun] Found tool event: tool_started - search_emails
[collectAgentRun] Found tool event: tool_completed - search_emails
[collectAgentRun] Collected 2 tool events, 512 total events
[security-alert] tools called: search_emails
[security-alert] pass=true  useful=true  correct=true  regress_changed=true

...

Saved summary -> tests/results/summary-2025-11-02T00-07-31-273Z.json
```

## Performance Metrics

- **Dev Host Startup**: ~1 second
- **Per Test Case**: ~10-15 seconds
- **Total Suite**: ~2 minutes (fast) / ~5-10 minutes (with LLM)
- **Snapshot Size**: ~50-100 KB per test

## Next Steps

1. Integrate into CI/CD pipeline
2. Set up continuous monitoring
3. Enable Pinecone write verification
4. Add performance benchmarks
5. Deploy to production and run against live endpoint

