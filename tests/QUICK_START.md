# E2E Test Quick Start

## What's New

The e2e test suite now verifies that server-side tools are being called correctly during agent execution. This includes:

- ✅ Tool invocation verification (which tools were called)
- ✅ Tool parameter capture (what parameters were passed)
- ✅ Tool result verification (what data was returned)
- ✅ Pinecone index tracking (how many vectors were added)

## Running Tests

### Prerequisites

```bash
# Ensure Azure Functions are running locally
npm run dev:functions

# In another terminal, run tests
cd tests
npm test
```

### Test Modes

**Standard mode** (with LLM judge):
```bash
npm test
```

**Fast mode** (skip LLM judge):
```bash
JUDGE_DISABLE_LLM=1 npm test
```

**With Pinecone verification** (requires Service Bus):
```bash
E2E_PINECONE_VERIFY=1 npm test
```

**Full verification**:
```bash
E2E_AGENT_VERIFY=1 E2E_PINECONE_VERIFY=1 JUDGE_DISABLE_LLM=1 npm test
```

## Understanding Test Output

### Console Output

```
[security-alert] tools called: search_emails, triage_recent_emails
[security-alert] pass=true  useful=true  correct=true  regress_changed=false
```

This shows:
- Which tools were invoked
- Whether the test passed
- Whether results were useful/correct
- Whether results changed from last run

### Test Snapshots

Results are saved to `tests/results/{test-id}-{timestamp}.json`:

```javascript
{
  "case": { /* test definition */ },
  "search_matches": [ /* search results */ ],
  "agent": {
    "tool_events": [
      {
        "type": "tool_started",
        "toolName": "search_emails",
        "parameters": { "query": "Security alert", "topK": 5 },
        "timestamp": 1698765432000
      },
      {
        "type": "tool_completed",
        "toolName": "search_emails",
        "durationMs": 245,
        "result": { "count": 3, "results": [...] },
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
            "parameters": { "query": "Security alert", "topK": 5 },
            "result": { "count": 3, "results": [...] }
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

## Debugging Failed Tests

### Tool Not Called

If you see: `Expected one of tools to be called: search_emails, triage_recent_emails; saw: none`

1. Check `agent.tool_events` in snapshot - should have `tool_started` events
2. Verify agent received the user query correctly
3. Check agent logs for errors
4. Verify grantId is correct

### Tool Called But Wrong Parameters

1. Check `tool_details[toolName].calls[0].parameters` in snapshot
2. Verify parameters match what agent should send
3. Check if agent is interpreting user query correctly

### Tool Result Missing Data

1. Check `tool_details[toolName].calls[0].result` in snapshot
2. Verify result has expected fields
3. Check backend tool implementation for data shape issues

### Pinecone Index Not Increasing

If `index_increase.increased` is false:

1. Verify `SERVICEBUS_CONNECTION` is set
2. Check Service Bus queue for pending messages
3. Verify backfill worker is running
4. Check Azure Functions logs for errors
5. Verify namespace (grantId) is correct

## Test Cases

### Current Test Cases

1. **security-alert**: Find security alert emails
2. **uc-berkeley-event**: Find UC Berkeley event emails
3. **yelp-prompt**: Find Yelp review request
4. **bandsintown**: Find music event notifications
5. **upwork-job**: Find job alerts
6. **rollup-week**: Weekly email rollup
7. **rollup-month**: Monthly email rollup
8. **unread-delta**: Unread emails with Pinecone verification
9. **attachment-summary**: Emails with attachments

### Adding New Test Cases

Edit `tests/cases.mjs`:

```javascript
{
  id: "my-test",
  scenario: "Test description",
  user_query: "User's question",
  namespace: "22dd5c25-157e-4377-af23-e06602fdfcec",
  search: { query: "search query", types: ["message"], topK: 5 },
  expect: "What should happen",
  
  // NEW: Specify expected tools
  agent_expect: { 
    requiredAnyOfTools: ["search_emails", "triage_recent_emails"] 
  },
  
  // NEW: Custom assertions
  assert({ matches, agent }) {
    if (!matches.length) throw new Error("Expected results");
    // Verify tool was called
    const toolNames = new Set(agent.toolEvents.map(e => e.toolName));
    if (!toolNames.has("search_emails")) {
      throw new Error("Expected search_emails");
    }
  }
}
```

## Available Tools

- `search_emails`: Semantic search over emails
- `list_unread_messages`: List unread emails
- `triage_recent_emails`: Triage recent emails
- `aggregate_emails`: Aggregate by metadata
- `list_contacts`: List contacts
- `list_events`: List calendar events

## Summary

The enhanced e2e suite now provides:

✅ **Visibility**: See exactly which tools are called and with what parameters
✅ **Verification**: Confirm tools return expected data shapes
✅ **Tracking**: Monitor Pinecone index changes during write operations
✅ **Debugging**: Detailed snapshots for troubleshooting failures
✅ **Regression**: Detect when tool behavior changes

For more details, see `E2E_TOOL_VERIFICATION.md`.

