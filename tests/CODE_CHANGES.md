# Code Changes - E2E Tool Verification

## File: tests/run.mjs

### New Helper Functions

#### 1. verifyToolInvocations()

```javascript
function verifyToolInvocations(toolEvents, expectations) {
  if (!expectations) return { passed: true, called: new Set(), missing: [] };
  
  const started = (toolEvents || []).filter(e => e.type === 'tool_started' || e.type === 'tool_call_started');
  const called = new Set(started.map(e => e.toolName).filter(Boolean));
  
  const missing = [];
  
  // Check requiredAnyOfTools
  if (expectations.requiredAnyOfTools?.length) {
    const ok = expectations.requiredAnyOfTools.some(t => called.has(t));
    if (!ok) {
      missing.push(`Expected one of: ${expectations.requiredAnyOfTools.join(', ')}; got: ${Array.from(called).join(', ') || 'none'}`);
    }
  }
  
  // Check requiredAllTools
  if (expectations.requiredAllTools?.length) {
    for (const tool of expectations.requiredAllTools) {
      if (!called.has(tool)) {
        missing.push(`Expected tool '${tool}' to be called; got: ${Array.from(called).join(', ') || 'none'}`);
      }
    }
  }
  
  return {
    passed: missing.length === 0,
    called,
    missing,
    toolEvents: started,
  };
}
```

#### 2. extractToolDetails()

```javascript
function extractToolDetails(toolEvents) {
  const details = {};
  
  for (const evt of toolEvents || []) {
    const toolName = evt.toolName;
    if (!toolName) continue;
    
    if (!details[toolName]) {
      details[toolName] = { calls: [] };
    }
    
    if (evt.type === 'tool_started' || evt.type === 'tool_call_started') {
      details[toolName].calls.push({
        started: evt.timestamp,
        parameters: evt.parameters,
      });
    } else if (evt.type === 'tool_completed' || evt.type === 'tool_call_completed') {
      const lastCall = details[toolName].calls[details[toolName].calls.length - 1];
      if (lastCall) {
        lastCall.completed = evt.timestamp;
        lastCall.durationMs = evt.durationMs;
        lastCall.result = evt.result;
      }
    }
  }
  
  return details;
}
```

#### 3. verifyToolResults()

```javascript
function verifyToolResults(toolDetails, expectations) {
  const errors = [];
  
  if (!expectations) return { passed: true, errors: [] };
  
  for (const [toolName, expectation] of Object.entries(expectations)) {
    const toolDetail = toolDetails[toolName];
    if (!toolDetail) {
      errors.push(`Tool '${toolName}' was not called`);
      continue;
    }
    
    const calls = toolDetail.calls || [];
    if (expectation.minCount && calls.length < expectation.minCount) {
      errors.push(`Tool '${toolName}' called ${calls.length} times; expected at least ${expectation.minCount}`);
    }
    
    // Verify result shape for first call
    if (calls.length > 0 && expectation.resultShape) {
      const result = calls[0].result;
      if (!result) {
        errors.push(`Tool '${toolName}' first call has no result`);
        continue;
      }
      
      for (const [key, type] of Object.entries(expectation.resultShape)) {
        if (!(key in result)) {
          errors.push(`Tool '${toolName}' result missing key '${key}'`);
        } else if (type && typeof result[key] !== type) {
          errors.push(`Tool '${toolName}' result['${key}'] is ${typeof result[key]}; expected ${type}`);
        }
      }
    }
  }
  
  return { passed: errors.length === 0, errors };
}
```

### Enhanced collectAgentRun()

Changed line 77 from:
```javascript
if (t && String(t).startsWith('tool_call_')) tool.push(evt);
```

To:
```javascript
if (t && String(t).startsWith('tool_')) tool.push(evt);
```

This captures both `tool_started`/`tool_completed` and `tool_call_started`/`tool_call_completed` events.

### Enhanced Agent Run Processing

```javascript
let agentRun = null;
let toolVerification = null;
if (E2E_AGENT_VERIFY) {
  try {
    agentRun = await collectAgentRun({ grantId: namespace, userInput: user_query });
    
    // Extract and verify tool invocations
    toolVerification = verifyToolInvocations(agentRun.toolEvents, c.agent_expect);
    const toolDetails = extractToolDetails(agentRun.toolEvents);
    
    snapshot.agent = {
      tool_events: agentRun.toolEvents,
      tool_details: toolDetails,
      tool_verification: {
        passed: toolVerification.passed,
        called: Array.from(toolVerification.called),
        missing: toolVerification.missing,
      },
      all_events_sample: agentRun.allEvents.slice(0, 50),
      final: agentRun.final,
    };
    
    // Log tool invocation summary
    if (toolVerification.called.size > 0) {
      console.log(`[${id}] tools called: ${Array.from(toolVerification.called).join(', ')}`);
    } else {
      console.warn(`[${id}] agent run had no tool invocations`);
    }
  } catch (err) {
    snapshot.agent_error = String(err?.message || err);
    console.warn(`[${id}] agent SSE collection failed:`, snapshot.agent_error);
  }
}

// Enforce agent tool expectations per-case
if (toolVerification && !toolVerification.passed) {
  throw new Error(`Tool verification failed for [${id}]: ${toolVerification.missing.join('; ')}`);
}
```

### Enhanced Pinecone Verification

```javascript
if (E2E_PINECONE_VERIFY && process.env.SERVICEBUS_CONNECTION && c.pineconeVerify === 'delta') {
  try {
    const beforeStats = await getIndexStats();
    const beforeCount = beforeStats?.session?.dense?.byNamespace?.[namespace]?.records || 0;
    snapshot.index_before = beforeCount;
    snapshot.index_stats_before = beforeStats;
    
    try {
      await postJSON(`${FUNCTIONS_BASE}/api/sync/delta`, { grantId: namespace });
      snapshot.delta_enqueued = true;
      console.log(`[${id}] Delta sync enqueued for namespace ${namespace}`);
    } catch (err) {
      snapshot.delta_error = String(err?.message || err);
      console.warn(`[${id}] Delta sync failed:`, snapshot.delta_error);
    }
    
    const waited = await waitForIndexIncrease({ namespace, before: beforeStats, timeoutMs: 60000 });
    snapshot.index_after = waited.after;
    snapshot.index_increase = {
      before: waited.before,
      after: waited.after,
      delta: waited.after - waited.before,
      increased: waited.increased,
    };
    
    if (!waited.increased) {
      console.warn(`[${id}] Pinecone index did not increase for ns=${namespace}: ${waited.before} -> ${waited.after}`);
    } else {
      console.log(`[${id}] Pinecone index increased: ${waited.before} -> ${waited.after} (+${waited.after - waited.before})`);
    }
  } catch (err) {
    snapshot.pinecone_verify_error = String(err?.message || err);
    console.warn(`[${id}] Pinecone verification error:`, snapshot.pinecone_verify_error);
  }
}
```

## File: tests/cases.mjs

### Updated Test Cases

All 9 test cases now include:

1. **`agent_expect` field**:
```javascript
agent_expect: { 
  requiredAnyOfTools: ["search_emails", "triage_recent_emails"] 
}
```

2. **Enhanced `assert` function** (example):
```javascript
assert({ matches, agent }) {
  if (!matches.length) throw new Error("Expected results");
  
  if (agent?.toolEvents?.length) {
    const toolNames = new Set(agent.toolEvents.map(e => e.toolName));
    if (!toolNames.has("search_emails")) {
      throw new Error("Expected search_emails tool");
    }
  }
}
```

### Example: security-alert

```javascript
{
  id: "security-alert",
  scenario: "User asks to find a Google security alert email",
  user_query: "Find the security alert from Google",
  namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
  search: { query: "Security alert", types: ["message"], topK: 5 },
  expect: "Functional: Retrieve at least one email relevant to a security alert...",
  agent_expect: { requiredAnyOfTools: ["search_emails", "triage_recent_emails"] },
  assert({ agent }) {
    if (!agent?.toolEvents?.length) {
      throw new Error("Expected agent to invoke at least one tool");
    }
    const toolNames = new Set(agent.toolEvents.map(e => e.toolName).filter(Boolean));
    if (!toolNames.has("search_emails") && !toolNames.has("triage_recent_emails")) {
      throw new Error(`Expected search_emails or triage_recent_emails; got: ${Array.from(toolNames).join(', ')}`);
    }
  },
}
```

## Summary of Changes

- **Lines added to run.mjs**: ~150 (helper functions + enhanced processing)
- **Lines modified in run.mjs**: ~30 (agent run collection + Pinecone verification)
- **Lines modified in cases.mjs**: ~50 (agent_expect + assert enhancements)
- **New documentation files**: 5 (E2E_TOOL_VERIFICATION.md, QUICK_START.md, etc.)

Total: ~230 lines of code changes + comprehensive documentation

