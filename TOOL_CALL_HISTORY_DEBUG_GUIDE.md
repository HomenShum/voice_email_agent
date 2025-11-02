# Tool Call History UI Debug Guide

## Problem Summary

The "Tool Call History" panel in the UI is empty, even though backend tool events are being emitted correctly from the Azure Functions `/api/agent` endpoint.

## Root Cause Analysis

### ✅ Backend is Working Correctly

I verified that the Azure Functions backend IS emitting tool events correctly:

```bash
node test-backend-events.mjs
```

**Results:**
- Event #257: `tool_started` for `search_emails` with full parameters
- Event #259: `tool_completed` for `search_emails` with result data
- Total events: 1285
- Tool started events: 1
- Tool completed events: 1

The backend is emitting events with the correct structure:
```json
{
  "type": "tool_started",
  "toolName": "search_emails",
  "agentId": "insights",
  "parameters": { "query": "...", "topK": 50, ... },
  "timestamp": 1234567890
}
```

### ❌ Client-Side Issue

The issue is on the **client side** - the UI is not displaying the tool events even though they're being received from the backend SSE stream.

## Debugging Steps

### Step 1: Open Browser Developer Console

1. Open your application in the browser
2. Press **F12** to open Developer Tools
3. Go to the **Console** tab

### Step 2: Test the Voice Agent

1. Click "Connect" to start the voice session
2. Speak or type a request like: "Can you search for emails about security alerts?"
3. Watch the console for debug messages

### Step 3: Check Console Logs

You should see these debug messages if events are being processed:

```
[main] handleBackendEvent called: tool_started {type: 'tool_started', toolName: 'search_emails', ...}
[main] Processing tool_started event: search_emails
[main] toolCallHistory now has 1 items
[main] renderToolResults called, toolCallHistory has 1 items
[main] Rendering 1 recent calls
```

```
[main] handleBackendEvent called: tool_completed {type: 'tool_completed', toolName: 'search_emails', ...}
[main] Processing tool_completed event: search_emails
[main] Found pending record for search_emails
[main] toolCallHistory now has 1 items
[main] renderToolResults called, toolCallHistory has 1 items
[main] Rendering 1 recent calls
```

### Step 4: Diagnose the Issue

#### Scenario A: No `handleBackendEvent` logs

**Problem:** Backend events are not reaching the client-side event handler.

**Possible Causes:**
1. `setBackendEventHandler` is not being called in `main.ts`
2. The hybrid agent bridge is not forwarding events
3. SSE stream is not being parsed correctly

**Fix:**
- Check that `setBackendEventHandler(handleBackendEvent)` is called in `main.ts`
- Verify that `onBackendEvent` callback is passed to `createVoiceSession`
- Check browser Network tab to see if SSE events are being received

#### Scenario B: `handleBackendEvent` logs but no `renderToolResults` logs

**Problem:** Event handler is being called but `renderToolResults` is not being invoked.

**Possible Causes:**
1. Exception thrown in event handler before `renderToolResults` is called
2. Logic error in switch statement

**Fix:**
- Check console for JavaScript errors
- Add breakpoint in `handleBackendEvent` to step through code

#### Scenario C: `renderToolResults` logs but UI still empty

**Problem:** Rendering function is being called but DOM is not being updated.

**Possible Causes:**
1. `resultsList` DOM element is not found
2. `toolCallHistory` array is empty or has wrong structure
3. CSS is hiding the elements

**Fix:**
- Check that `<ul id="results-list">` exists in `index.html`
- Inspect `toolCallHistory` array in console: `console.log(toolCallHistory)`
- Check CSS for `display: none` or `visibility: hidden`

#### Scenario D: All logs present but UI still empty

**Problem:** Everything is working but the UI panel might be collapsed or hidden.

**Possible Causes:**
1. Sidebar is collapsed
2. Panel is scrolled out of view
3. CSS issue hiding the panel

**Fix:**
- Click "Toggle sidebar" button to expand sidebar
- Scroll down in the sidebar to find "Tool Call History" section
- Inspect element in DevTools to check computed styles

## Verification Checklist

- [ ] Backend emits `tool_started` and `tool_completed` events (verified with `test-backend-events.mjs`)
- [ ] Client receives SSE events from `/api/agent` endpoint (check Network tab)
- [ ] `handleBackendEvent` is called with correct event types (check Console logs)
- [ ] `toolCallHistory` array is populated (check Console logs)
- [ ] `renderToolResults` is called (check Console logs)
- [ ] `<ul id="results-list">` DOM element exists (check Elements tab)
- [ ] Tool call items are rendered to DOM (check Elements tab)
- [ ] Sidebar is expanded and visible (check UI)

## Expected UI Behavior

When working correctly, the "Tool Call History" panel should display:

```
Tool Call History
─────────────────
• search_emails (12:34:56 PM) [OK]
  Agent: insights
  Params: query: "security alert...", topK: 50
  Result: count: 50
  Duration: 2435ms
```

## Quick Fix Commands

### Rebuild Client
```bash
npm run build
```

### Test Backend Events
```bash
node test-backend-events.mjs
```

### Check Environment Variables
```bash
# PowerShell
$env:FUNCTIONS_BASE
$env:GRANT_ID

# Should output:
# https://func-email-agent-9956-lx.azurewebsites.net
# 22dd5c25-157e-4377-af23-e06602fdfcec
```

## Next Steps

1. **Open the application in your browser**
2. **Open Developer Console (F12)**
3. **Test the voice agent with a request**
4. **Check console logs** to see which scenario applies
5. **Report back** with the console output so I can help diagnose further

## Additional Resources

- **Backend Test Script:** `test-backend-events.mjs`
- **Main UI File:** `src/main.ts` (lines 807-886 for event handling)
- **Render Function:** `src/main.ts` (lines 282-350 for UI rendering)
- **Voice Agent:** `src/lib/voiceAgent.ts` (lines 176-183 for event forwarding)
- **Hybrid Bridge:** `src/lib/agents/hybridAgentBridge.ts` (line 227 for event emission)

## Summary

The backend is confirmed working and emitting tool events correctly. The issue is on the client side where events are either:
1. Not being received from the SSE stream
2. Not being processed by the event handler
3. Not being rendered to the DOM
4. Being rendered but hidden by CSS or UI state

Use the debugging steps above to identify which scenario applies, then apply the appropriate fix.

