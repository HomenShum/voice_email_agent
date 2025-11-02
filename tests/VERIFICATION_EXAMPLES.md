# Tool Verification Examples

## Example 1: Basic Tool Verification

### Test Case

```javascript
{
  id: "security-alert",
  scenario: "User asks to find a Google security alert email",
  user_query: "Find the security alert from Google",
  namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
  search: { query: "Security alert", types: ["message"], topK: 5 },
  expect: "Functional: Retrieve at least one email relevant to a security alert...",
  
  // Verify that at least one of these tools is called
  agent_expect: { 
    requiredAnyOfTools: ["search_emails", "triage_recent_emails"] 
  },
  
  // Custom assertion with tool verification
  assert({ matches, agent }) {
    if (!matches.length) throw new Error("Expected results");
    
    if (agent?.toolEvents?.length) {
      const toolNames = new Set(agent.toolEvents.map(e => e.toolName));
      if (!toolNames.has("search_emails") && !toolNames.has("triage_recent_emails")) {
        throw new Error(`Expected search_emails or triage_recent_emails; got: ${Array.from(toolNames).join(', ')}`);
      }
    }
  }
}
```

### Snapshot Output

```json
{
  "agent": {
    "tool_events": [
      {
        "type": "tool_started",
        "toolName": "search_emails",
        "grantId": "22dd5c25-157e-4377-af23-e06602fdfcec",
        "parameters": {
          "query": "Security alert",
          "topK": 5,
          "dateFrom": null,
          "dateTo": null
        },
        "timestamp": 1698765432000
      },
      {
        "type": "tool_completed",
        "toolName": "search_emails",
        "grantId": "22dd5c25-157e-4377-af23-e06602fdfcec",
        "durationMs": 245,
        "result": {
          "count": 3,
          "results": [
            {
              "id": "msg_123",
              "score": 0.95,
              "subject": "Google Account Security Alert",
              "from": "security-noreply@google.com",
              "date": "2025-10-28T10:30:00Z",
              "snippet": "We detected unusual activity..."
            }
          ]
        },
        "timestamp": 1698765432245
      }
    ],
    "tool_details": {
      "search_emails": {
        "calls": [
          {
            "started": 1698765432000,
            "completed": 1698765432245,
            "durationMs": 245,
            "parameters": {
              "query": "Security alert",
              "topK": 5
            },
            "result": {
              "count": 3,
              "results": [...]
            }
          }
        ]
      }
    },
    "tool_verification": {
      "passed": true,
      "called": ["search_emails"],
      "missing": []
    }
  }
}
```

## Example 2: Unread Messages with Tool Verification

### Test Case

```javascript
{
  id: "unread-delta",
  scenario: "Pull latest unread since the last pull",
  user_query: "Fetch unread since last run",
  namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
  search: {
    query: "recent unread",
    types: ["message"],
    topK: 5
  },
  expect: "Show recent unread items since the last checkpoint...",
  
  // Require one of these tools
  agent_expect: { 
    requiredAnyOfTools: ["search_emails", "list_unread_messages", "triage_recent_emails"] 
  },
  
  // Verify unread metadata AND tool invocation
  assert({ matches, agent }) {
    const list = Array.isArray(matches) ? matches : [];
    if (!list.length) throw new Error("Expected unread query to return at least one match");
    
    // Verify metadata
    const withUnread = list.filter((m) => m && typeof m?.metadata?.unread !== "undefined");
    if (!withUnread.length) {
      throw new Error("Expected at least one match with metadata.unread present");
    }
    
    if (!withUnread.some((m) => m.metadata.unread === true)) {
      throw new Error("Expected at least one unread=true match");
    }
    
    // Verify tool was invoked
    if (agent?.toolEvents?.length) {
      const toolNames = new Set(agent.toolEvents.map(e => e.toolName));
      const hasUnreadTool = toolNames.has("list_unread_messages");
      if (!hasUnreadTool) {
        console.warn(`Expected list_unread_messages; got: ${Array.from(toolNames).join(', ')}`);
      }
    }
  }
}
```

## Example 3: Pinecone Index Verification

### Test Case

```javascript
{
  id: "unread-delta",
  scenario: "Pull latest unread since the last pull",
  user_query: "Fetch unread since last run",
  namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
  
  // Enable Pinecone verification
  pineconeVerify: "delta",
  
  // ... rest of test case
}
```

### Snapshot Output

```json
{
  "index_before": 1250,
  "index_stats_before": {
    "session": {
      "dense": {
        "byNamespace": {
          "22dd5c25-157e-4377-af23-e06602fdfcec": {
            "records": 1250
          }
        }
      }
    }
  },
  "delta_enqueued": true,
  "index_after": 1275,
  "index_increase": {
    "before": 1250,
    "after": 1275,
    "delta": 25,
    "increased": true
  }
}
```

### Console Output

```
[unread-delta] Delta sync enqueued for namespace 22dd5c25-157e-4377-af23-e06602fdfcec
[unread-delta] Pinecone index increased: 1250 -> 1275 (+25)
```

## Example 4: Multiple Tool Verification

### Test Case

```javascript
{
  id: "complex-query",
  scenario: "Complex query requiring multiple tools",
  user_query: "Show me recent emails and summarize by sender",
  namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
  
  // Require ALL of these tools
  agent_expect: { 
    requiredAllTools: ["search_emails", "aggregate_emails"] 
  },
  
  assert({ matches, aggregation, agent }) {
    // Verify search results
    if (!matches.length) throw new Error("Expected search results");
    
    // Verify aggregation results
    if (!aggregation?.aggregations?.length) {
      throw new Error("Expected aggregation results");
    }
    
    // Verify both tools were called
    if (agent?.toolEvents?.length) {
      const toolNames = new Set(agent.toolEvents.map(e => e.toolName));
      if (!toolNames.has("search_emails")) {
        throw new Error("Expected search_emails tool");
      }
      if (!toolNames.has("aggregate_emails")) {
        throw new Error("Expected aggregate_emails tool");
      }
    }
  }
}
```

## Example 5: Tool Parameter Verification

### Custom Assertion

```javascript
assert({ agent }) {
  if (!agent?.toolEvents?.length) {
    throw new Error("Expected tool invocation");
  }
  
  // Find search_emails tool call
  const searchCall = agent.toolEvents.find(e => 
    e.type === "tool_started" && e.toolName === "search_emails"
  );
  
  if (!searchCall) {
    throw new Error("Expected search_emails to be called");
  }
  
  // Verify parameters
  const params = searchCall.parameters;
  if (!params.query) {
    throw new Error("Expected query parameter");
  }
  if (params.topK !== 5) {
    throw new Error(`Expected topK=5; got ${params.topK}`);
  }
  if (!params.dateFrom && !params.dateTo) {
    console.warn("No date filters applied");
  }
}
```

## Example 6: Tool Duration Tracking

### Custom Assertion

```javascript
assert({ agent }) {
  if (!agent?.toolDetails) return;
  
  for (const [toolName, detail] of Object.entries(agent.toolDetails)) {
    for (const call of detail.calls || []) {
      const duration = call.durationMs;
      
      // Flag slow tools
      if (duration > 1000) {
        console.warn(`[${toolName}] took ${duration}ms (slow)`);
      }
      
      // Verify tool completed
      if (!call.completed) {
        throw new Error(`[${toolName}] did not complete`);
      }
    }
  }
}
```

## Running Examples

```bash
# Run all tests with tool verification
npm test

# Run specific test
npm test -- --grep "security-alert"

# Run with detailed output
DEBUG=* npm test

# Run with Pinecone verification
E2E_PINECONE_VERIFY=1 npm test
```

## Interpreting Results

### Success

```
[security-alert] tools called: search_emails
[security-alert] pass=true  useful=true  correct=true  regress_changed=false
```

### Failure - Tool Not Called

```
Tool verification failed for [security-alert]: Expected one of tools to be called: search_emails, triage_recent_emails; saw: none
```

### Failure - Wrong Tool Called

```
Tool verification failed for [security-alert]: Expected one of tools to be called: search_emails, triage_recent_emails; saw: list_contacts
```

### Failure - Pinecone Not Increased

```
Pinecone index did not increase for ns=22dd5c25-157e-4377-af23-e06602fdfcec: 1250 -> 1250
```

