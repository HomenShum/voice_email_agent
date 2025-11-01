# Hybrid Agent Architecture - Complete Implementation Guide

## Overview

This document describes the **Hybrid Agent Architecture** that separates voice I/O from backend processing logic, providing:

1. **Backend Processing Layer** - Standard `Agent` with `gpt-5-mini` for all data processing, tool execution, and decision-making
2. **Voice Narration Layer** - `RealtimeAgent` with `gpt-realtime-mini` for voice I/O only (narration, not processing)
3. **Real-Time UI Dashboard** - React component displaying hierarchical agent activity with live updates
4. **Event Bridge** - Streaming mechanism connecting backend events to voice narration and UI visualization

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER VOICE INPUT                              │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│         VOICE NARRATION LAYER (Browser)                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ RealtimeAgent (gpt-realtime-mini)                         │  │
│  │ - Immediate acknowledgment: "Let me check that for you"  │  │
│  │ - Narrates backend progress asynchronously               │  │
│  │ - Provides final voice summary                           │  │
│  │ - NO tool execution, NO decision-making                  │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              EVENT BRIDGE (WebSocket/SSE)                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ BackendEventStream                                        │  │
│  │ - Streams events from backend to voice layer             │  │
│  │ - Streams events from backend to UI dashboard            │  │
│  │ - Formats events for voice narration                     │  │
│  │ - Formats events for UI visualization                    │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│       BACKEND PROCESSING LAYER (Azure Functions)                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ RouterAgent (Agent + gpt-5-mini)                          │  │
│  │ - Analyzes user intent                                    │  │
│  │ - Delegates to specialist agents                          │  │
│  │ - Emits lifecycle events                                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                         ▼                                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Specialist Agents (Agent + gpt-5-mini)                    │  │
│  │ - EmailOpsAgent: Email triage, search, filtering          │  │
│  │ - InsightAgent: Analytics, trends, aggregations           │  │
│  │ - ContactsAgent: Contact search, relationship mapping     │  │
│  │ - CalendarAgent: Event lookups, availability checks       │  │
│  │ - AutomationAgent: Workflow automation (pending)          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                         ▼                                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Tool Execution                                            │  │
│  │ - triage_recent_emails                                    │  │
│  │ - list_unread_messages                                    │  │
│  │ - search_emails                                           │  │
│  │ - aggregate_emails                                        │  │
│  │ - list_contacts                                           │  │
│  │ - list_events                                             │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              UI DASHBOARD (React Component)                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ AgentActivityDashboard                                    │  │
│  │ Level 1: Current active agent (RouterAgent/specialist)   │  │
│  │ Level 2: Tasks delegated to each agent (timestamps)      │  │
│  │ Level 3: Tool calls per task (parameters + results)      │  │
│  │ Level 4: Live status (queued, in-progress, completed)    │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Answering Your Questions

### 1. How do I connect a standard `Agent` (gpt-5-mini) with a `RealtimeAgent` (gpt-realtime-mini)?

**Answer**: Use the **Event Bridge Pattern** implemented in `hybridAgentBridge.ts`.

The connection works through event streaming:

```typescript
// Backend Agent emits lifecycle events
agent.on('agent_start', () => {
  emitEvent({ type: 'agent_started', agentId, agentName, timestamp });
});

agent.on('agent_tool_start', (context, tool, details) => {
  emitEvent({ type: 'tool_started', agentId, toolName, parameters, timestamp });
});

// Event Bridge forwards events to Voice Narration Layer
eventStream.subscribe(async (event) => {
  if (voiceSession && voiceSession.isConnected()) {
    await voiceSession.receiveBackendEvent(event);
  }
});

// Voice Narration Layer narrates the event
const narration = formatEventForVoiceNarration(event);
// "I'm routing your request to the Email Operations Agent..."
// "The agent is now calling the triage_recent_emails tool..."
await voiceSession.narrate(narration);
```

**Key Files**:
- `src/lib/agents/backendRouterAgent.ts` - Backend agents with lifecycle hooks
- `src/lib/agents/voiceNarrationAgent.ts` - Voice narration layer
- `src/lib/agents/hybridAgentBridge.ts` - Event bridge connecting them

---

### 2. How do I emit real-time events from the backend `Agent` workflow?

**Answer**: Use **lifecycle hooks** provided by the OpenAI Agents SDK.

The standard `Agent` class supports these lifecycle events:

```typescript
const agent = new Agent({
  name: 'EmailOpsAgent',
  model: 'gpt-5-mini',
  instructions: '...',
  tools: [triageRecentEmails, listUnreadMessages],
});

// Lifecycle hooks for event emission
agent.on('agent_start', () => {
  console.log('Agent started');
  emitEvent({ type: 'agent_started', ... });
});

agent.on('agent_end', (context, output) => {
  console.log('Agent completed');
  emitEvent({ type: 'agent_completed', output, ... });
});

agent.on('agent_tool_start', (context, tool, details) => {
  console.log('Tool started:', tool.name);
  emitEvent({ type: 'tool_started', toolName: tool.name, ... });
});

agent.on('agent_tool_end', (context, tool, result) => {
  console.log('Tool completed:', tool.name);
  emitEvent({ type: 'tool_completed', toolName: tool.name, result, ... });
});

agent.on('agent_handoff', (context, nextAgent) => {
  console.log('Handoff to:', nextAgent.name);
  emitEvent({ type: 'agent_handoff', toAgent: nextAgent.name, ... });
});
```

**Available Lifecycle Events**:
- `agent_start` - Agent begins processing
- `agent_end` - Agent completes processing
- `agent_tool_start` - Tool execution begins
- `agent_tool_end` - Tool execution completes
- `agent_handoff` - Agent delegates to another agent

**Key Files**:
- `src/lib/agents/backendRouterAgent.ts` - Shows lifecycle hook implementation
- `src/lib/agents/backendRuntime.ts` - Event streaming infrastructure

---

### 3. Should I use the `run()` function for backend agents and stream results?

**Answer**: **YES!** Use `run()` with `{ stream: true }` for real-time event streaming.

```typescript
import { Agent, run } from '@openai/agents';

const agent = new Agent({
  name: 'RouterAgent',
  model: 'gpt-5-mini',
  instructions: '...',
  handoffs: [emailOpsAgent, insightAgent, contactsAgent],
});

// Run with streaming enabled
const stream = await run(agent, userInput, { stream: true });

// Process streaming events
for await (const event of stream) {
  console.log('Stream event:', event.type);

  if (event.type === 'agent_updated_stream_event') {
    console.log('Agent switched to:', event.agent.name);
    // Emit to voice narration layer
  } else if (event.type === 'run_item_stream_event') {
    console.log('Run item:', event.item);
    // Tool calls, outputs, etc.
  }
}

// Wait for completion
await stream.completed;
const finalResult = stream.result;
```

**Benefits of Streaming**:
1. Real-time progress updates to voice layer
2. Live UI dashboard updates
3. Better user experience (no waiting for final result)
4. Ability to interrupt long-running operations

**Key Files**:
- `src/lib/agents/backendRuntime.ts` - `runBackendAgent()` function with streaming

---

### 4. How do I structure the handoff between voice and processing layers?

**Answer**: Use the **HybridAgentBridge** pattern with clear separation of concerns.

```typescript
// 1. Create the hybrid bridge
const bridge = createHybridAgentBridge({
  tools: { email, insights, contacts, calendar, sync },
  voice: 'alloy',
  onUIDashboardEvent: (event) => {
    // Update React UI state
    setDashboardEvents(prev => [...prev, event]);
  },
});

// 2. Connect voice layer
const apiKey = await fetch('/api/realtime/session')
  .then(r => r.json())
  .then(d => d.client_secret.value);
await bridge.connectVoice(apiKey);

// 3. Process user request
const result = await bridge.processUserRequest('Show me my recent emails');

// Behind the scenes:
// Step 1: Voice layer provides immediate acknowledgment
//         "Let me check your emails for you."
//
// Step 2: Backend layer processes with gpt-5-mini
//         RouterAgent → EmailOpsAgent → triage_recent_emails tool
//
// Step 3: Backend events streamed to voice layer
//         "I'm routing your request to the Email Operations Agent..."
//         "The agent is now calling the triage_recent_emails tool..."
//
// Step 4: Voice layer provides final summary
//         "I found 5 urgent emails about interviews..."
```

**Key Principles**:
1. **Voice layer NEVER executes tools** - It only narrates
2. **Backend layer NEVER handles voice I/O** - It only processes
3. **Event bridge connects them** - Unidirectional event flow
4. **UI dashboard observes events** - No business logic

**Key Files**:
- `src/lib/agents/hybridAgentBridge.ts` - Main integration point
- `src/lib/hybridVoiceAgent.ts` - High-level API and React hook

---

## Implementation Files

### Backend Processing Layer
- `src/lib/agents/backendRouterAgent.ts` - RouterAgent and specialists (Agent + gpt-5-mini)
- `src/lib/agents/backendRuntime.ts` - Runtime management and event streaming

### Voice Narration Layer
- `src/lib/agents/voiceNarrationAgent.ts` - Voice narrator (RealtimeAgent + gpt-realtime-mini)

### Event Bridge
- `src/lib/agents/hybridAgentBridge.ts` - Connects backend and voice layers

### UI Dashboard
- `src/components/AgentActivityDashboard.tsx` - React component for visualization
- `src/components/AgentActivityDashboard.css` - Styling

### High-Level API
- `src/lib/hybridVoiceAgent.ts` - Simplified API and React hook

---

## Usage Example

```typescript
import { createHybridVoiceAgent } from './lib/hybridVoiceAgent';
import { emailOpsToolset, insightToolset, contactsToolset, calendarToolset } from './lib/tools';

// Create and connect the hybrid agent
const agent = await createHybridVoiceAgent({
  tools: {
    email: Array.from(emailOpsToolset),
    insights: Array.from(insightToolset),
    contacts: Array.from(contactsToolset),
    calendar: Array.from(calendarToolset),
  },
  voice: 'alloy',
  onProgress: (message) => console.log('[Progress]', message),
  onTranscript: (history) => console.log('[Transcript]', history),
  onUIDashboardEvent: (event) => {
    // Update React UI state
    setDashboardEvents(prev => [...prev, event]);
  },
});

// Process user request
const result = await agent.processRequest('Show me my recent emails');
console.log('Final result:', result);

// Disconnect when done
await agent.disconnect();
```

---

## React Integration

```tsx
import { useHybridVoiceAgent } from './lib/hybridVoiceAgent';
import { AgentActivityDashboard } from './components/AgentActivityDashboard';

function VoiceAgentUI() {
  const { agent, isConnected, dashboardEvents, processRequest } = useHybridVoiceAgent({
    tools: { email, insights, contacts, calendar },
    voice: 'alloy',
  });

  const handleUserInput = async (input: string) => {
    const result = await processRequest(input);
    console.log('Result:', result);
  };

  return (
    <div>
      <h1>Voice Email Agent</h1>
      <p>Status: {isConnected ? 'Connected' : 'Disconnected'}</p>
      
      <button onClick={() => handleUserInput('Show me my recent emails')}>
        Test Voice Agent
      </button>

      <AgentActivityDashboard 
        onEventReceived={(event) => {
          // Events are automatically added via the hook
        }}
      />
    </div>
  );
}
```

---

## Benefits of This Architecture

1. **Cost Efficiency** - Use expensive `gpt-realtime-mini` only for voice I/O, not processing
2. **Better Control** - Backend logic runs on `gpt-5-mini` with full control over tools and decisions
3. **Real-Time Feedback** - Voice narration provides asynchronous progress updates
4. **UI Visibility** - Dashboard shows hierarchical agent activity in real-time
5. **Separation of Concerns** - Voice, processing, and UI are completely decoupled
6. **Scalability** - Backend can run on Azure Functions, voice runs in browser
7. **Testability** - Backend agents can be tested independently of voice layer

---

## Next Steps

1. **Test the backend agents** - Run `backendRuntime.ts` with sample inputs
2. **Test the voice narration** - Connect `voiceNarrationAgent.ts` to OpenAI Realtime API
3. **Wire up the UI dashboard** - Integrate `AgentActivityDashboard.tsx` into your React app
4. **Deploy to Azure Functions** - Move backend agents to serverless functions
5. **Add error handling** - Implement retry logic and error recovery
6. **Add authentication** - Secure the API endpoints
7. **Add monitoring** - Track agent performance and costs

---

## References

- [OpenAI Agents JS Documentation](https://openai.github.io/openai-agents-js/)
- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime)
- [Agent Lifecycle Hooks](https://openai.github.io/openai-agents-js/guides/agents)
- [Streaming with Agents](https://openai.github.io/openai-agents-js/guides/streaming)

