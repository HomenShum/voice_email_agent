# E2E Tool Verification Guide

This document describes the enhanced end-to-end testing framework for verifying server-side tool execution in the email agent.

## Overview

The e2e test suite now captures and verifies:

1. **Tool Invocation Verification**: Confirms that specific tools were called during agent execution
2. **Tool Parameter Verification**: Validates that tools received expected parameters
3. **Tool Result Verification**: Checks that tool results have correct data shapes
4. **Pinecone Index Verification**: Tracks vector count changes during write operations (backfill/sync)

## Test Case Structure

### Basic Tool Verification

```javascript
{
  id: "security-alert",
  scenario: "User asks to find a Google security alert email",
  user_query: "Find the security alert from Google",
  namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
  search: { query: "Security alert", types: ["message"], topK: 5 },
  expect: "Functional: Retrieve at least one email relevant to a security alert...",
  
  // NEW: Specify which tools must be called
  agent_expect: { 
    requiredAnyOfTools: ["search_emails", "triage_recent_emails"] 
  },
  
  // NEW: Custom assertions with tool event access
  assert({ matches, agent }) {
    // Verify search results
    if (!matches.length) throw new Error("Expected results");
    
    // Verify tool invocation
    if (agent?.toolEvents?.length) {
      const toolNames = new Set(agent.toolEvents.map(e => e.toolName));
      if (!toolNames.has("search_emails")) {
        throw new Error("Expected search_emails tool");
      }
    }
  }
}
```

### Tool Expectation Options

```javascript
agent_expect: {
  // At least one of these tools must be called
  requiredAnyOfTools: ["search_emails", "list_unread_messages"],
  
  // All of these tools must be called
  requiredAllTools: ["search_emails", "aggregate_emails"],
  
  // Verify tool result shapes
  resultShape: {
    search_emails: { count: "number", results: "object" },
    aggregate_emails: { groupBy: "string", aggregations: "object" }
  },
  
  // Minimum number of times each tool should be called
  minCallCount: {
    search_emails: 1,
    aggregate_emails: 1
  }
}
```

## Available Tools

The backend agent has access to these tools:

### Email Operations
- **search_emails**: Semantic search over emails with hybrid vector + sparse search
- **list_unread_messages**: List unread emails from Nylas
- **triage_recent_emails**: Triage recent emails to identify urgent/important messages

### Insights
- **aggregate_emails**: Aggregate email counts by metadata fields (from_domain, date, etc.)

### Contacts
- **list_contacts**: List contacts from Nylas

### Calendar
- **list_events**: List calendar events from Nylas

## Tool Event Structure

Each tool invocation generates events:

```javascript
// Tool started event
{
  type: "tool_started",
  toolName: "search_emails",
  grantId: "22dd5c25-157e-4377-af23-e06602fdfcec",
  parameters: { query: "Security alert", topK: 5 },
  timestamp: 1698765432000
}

// Tool completed event
{
  type: "tool_completed",
  toolName: "search_emails",
  grantId: "22dd5c25-157e-4377-af23-e06602fdfcec",
  durationMs: 245,
  result: { count: 3, results: [...] },
  timestamp: 1698765432245
}
```

## Snapshot Output

Test snapshots now include detailed tool information:

```javascript
{
  case: { /* test case definition */ },
  search_matches: [ /* search results */ ],
  aggregation: { /* aggregation results */ },
  agent: {
    tool_events: [ /* all tool events */ ],
    tool_details: {
      search_emails: {
        calls: [
          {
            started: 1698765432000,
            completed: 1698765432245,
            durationMs: 245,
            parameters: { query: "Security alert", topK: 5 },
            result: { count: 3, results: [...] }
          }
        ]
      }
    },
    tool_verification: {
      passed: true,
      called: ["search_emails"],
      missing: []
    },
    final: { /* agent final output */ }
  }
}
```

## Pinecone Index Verification

For write operations (backfill/sync), enable verification:

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

Snapshot will include:

```javascript
{
  index_before: 1250,
  index_after: 1275,
  index_increase: {
    before: 1250,
    after: 1275,
    delta: 25,
    increased: true
  },
  delta_enqueued: true
}
```

## Running Tests

### Run all tests with tool verification
```bash
E2E_AGENT_VERIFY=1 npm test
```

### Run with Pinecone verification
```bash
E2E_AGENT_VERIFY=1 E2E_PINECONE_VERIFY=1 npm test
```

### Run with LLM judge disabled (faster)
```bash
JUDGE_DISABLE_LLM=1 E2E_AGENT_VERIFY=1 npm test
```

## Debugging Tool Issues

If a test fails due to tool verification:

1. **Check tool_events in snapshot**: `tests/results/{test-id}-{timestamp}.json`
2. **Verify tool was called**: Look for `tool_started` event with correct `toolName`
3. **Check tool parameters**: Verify `parameters` match expectations
4. **Check tool result**: Verify `result` has expected shape and data
5. **Check tool duration**: `durationMs` indicates if tool execution was slow

Example debugging:
```javascript
// In snapshot, if tool_events is empty:
// - Agent may not have invoked tools
// - Check agent final output for errors
// - Verify grantId is correct

// If tool_events exist but tool_verification.passed is false:
// - Check tool_verification.missing for specific failures
// - Verify agent_expect matches actual tool names
```

## Best Practices

1. **Be specific with tool expectations**: Use `requiredAnyOfTools` or `requiredAllTools` based on your test intent
2. **Verify result shapes**: Add `resultShape` expectations to catch data structure issues
3. **Use custom assertions**: Combine tool events with search results for comprehensive verification
4. **Enable Pinecone verification for write tests**: Confirm data is actually persisted
5. **Check snapshots regularly**: Review `tests/results/` to understand tool behavior patterns

