# Hybrid Agent Architecture - Quick Start Guide

## 🚀 Get Started in 5 Minutes

This guide shows you how to use the new hybrid agent architecture in your voice email agent project.

---

## Step 1: Import the Hybrid Agent

```typescript
import { createHybridVoiceAgent } from './lib/hybridVoiceAgent';
import { 
  emailOpsToolset, 
  insightToolset, 
  contactsToolset, 
  calendarToolset, 
  syncToolset 
} from './lib/tools';
```

---

## Step 2: Create the Agent

```typescript
const agent = await createHybridVoiceAgent({
  // Your existing tools
  tools: {
    email: Array.from(emailOpsToolset),
    insights: Array.from(insightToolset),
    contacts: Array.from(contactsToolset),
    calendar: Array.from(calendarToolset),
    sync: Array.from(syncToolset),
  },

  // Voice configuration
  voice: 'alloy', // or 'echo', 'fable', 'onyx', 'nova', 'shimmer'

  // Event handlers
  onProgress: (message) => {
    console.log('[Progress]', message);
  },

  onTranscript: (history) => {
    console.log('[Transcript]', history);
  },

  onUIDashboardEvent: (event) => {
    console.log('[Dashboard]', event);
    // Update your React UI state here
  },
});
```

---

## Step 3: Process User Requests

```typescript
// Process a user request
const result = await agent.processRequest('Show me my recent emails');

console.log('Final result:', result);

// What happens behind the scenes:
// 1. Voice: "Let me check your emails for you" (immediate acknowledgment)
// 2. Backend: RouterAgent → EmailOpsAgent → triage_recent_emails (gpt-5-mini)
// 3. Voice: "I'm routing to EmailOpsAgent..." (async narration)
// 4. Voice: "The agent is calling triage_recent_emails..." (async narration)
// 5. Voice: "I found 5 urgent emails about interviews" (final summary)
```

---

## Step 4: Add the UI Dashboard (Optional)

### 4.1: Import the Dashboard Component

```tsx
import { AgentActivityDashboard } from './components/AgentActivityDashboard';
import './components/AgentActivityDashboard.css';
```

### 4.2: Add State for Dashboard Events

```tsx
function VoiceAgentUI() {
  const [dashboardEvents, setDashboardEvents] = React.useState([]);

  // ... create agent with onUIDashboardEvent handler
  const agent = await createHybridVoiceAgent({
    tools: { email, insights, contacts, calendar, sync },
    voice: 'alloy',
    onUIDashboardEvent: (event) => {
      setDashboardEvents(prev => [...prev, event]);
    },
  });

  return (
    <div>
      <AgentActivityDashboard events={dashboardEvents} />
    </div>
  );
}
```

---

## Step 5: Use the React Hook (Alternative)

If you prefer a React hook, use `useHybridVoiceAgent`:

```tsx
import { useHybridVoiceAgent } from './lib/hybridVoiceAgent';
import { AgentActivityDashboard } from './components/AgentActivityDashboard';

function VoiceAgentUI() {
  const { 
    agent, 
    isConnected, 
    dashboardEvents, 
    processRequest,
    clearDashboard 
  } = useHybridVoiceAgent({
    tools: { email, insights, contacts, calendar, sync },
    voice: 'alloy',
  });

  const handleUserInput = async (input: string) => {
    const result = await processRequest(input);
    console.log('Result:', result);
  };

  return (
    <div>
      <h1>Voice Email Agent</h1>
      <p>Status: {isConnected ? '✅ Connected' : '❌ Disconnected'}</p>
      
      <button onClick={() => handleUserInput('Show me my recent emails')}>
        Test Voice Agent
      </button>

      <button onClick={clearDashboard}>
        Clear Dashboard
      </button>

      <AgentActivityDashboard events={dashboardEvents} />
    </div>
  );
}
```

---

## 🎯 What You Get

### 1. Backend Processing (gpt-5-mini)
- ✅ RouterAgent analyzes user intent
- ✅ Delegates to specialist agents (EmailOps, Insight, Contacts, Calendar)
- ✅ Executes tools (triage_recent_emails, list_unread_messages, etc.)
- ✅ Emits lifecycle events for real-time updates

### 2. Voice Narration (gpt-realtime-mini)
- ✅ Immediate acknowledgment: "Let me check that for you"
- ✅ Async narration: "I'm routing to EmailOpsAgent..."
- ✅ Progress updates: "The agent is calling triage_recent_emails..."
- ✅ Final summary: "I found 5 urgent emails about interviews"

### 3. UI Dashboard (React)
- ✅ Level 1: Current active agent
- ✅ Level 2: Tasks delegated to each agent
- ✅ Level 3: Tool calls with parameters and results
- ✅ Level 4: Live status (⏳ pending, 🔄 in-progress, ✅ completed, ❌ error)

---

## 📊 Example Flow

```
User: "Can you help me with the latest five unread emails about interviews?"

Voice Agent (immediate): "Let me check your emails for you."

Backend (processing):
  RouterAgent → EmailOpsAgent → triage_recent_emails(limit=5)

Voice Agent (narrating):
  "I'm routing your request to the Email Operations Agent..."
  "The agent is now calling the triage_recent_emails tool with 5 messages..."

UI Dashboard (updating):
  🤖 RouterAgent [in-progress]
    └─ 🔀 Handoff to EmailOpsAgent
       └─ 🤖 EmailOpsAgent [in-progress]
          └─ 🔧 triage_recent_emails [in-progress]
             └─ ✅ triage_recent_emails [completed]
                └─ Result: { urgent: 5, ... }

Voice Agent (final): "I found 5 urgent emails about interviews. The most recent is from..."
```

---

## 🔧 Backward Compatibility

If you have existing code using `voiceAgent.ts`, you can use the drop-in replacement:

```typescript
// OLD CODE
import { createVoiceSession } from './lib/voiceAgent';
const session = await createVoiceSession();

// NEW CODE (same API!)
import { createHybridVoiceSession } from './lib/voiceAgentHybrid';
const session = await createHybridVoiceSession();

// Everything else works the same!
const result = await session.processInput('Show me my recent emails');
```

---

## 📁 File Structure

```
src/
├── lib/
│   ├── agents/
│   │   ├── backendRouterAgent.ts      # Backend agents (gpt-5-mini)
│   │   ├── backendRuntime.ts          # Event streaming
│   │   ├── voiceNarrationAgent.ts     # Voice narrator (gpt-realtime-mini)
│   │   └── hybridAgentBridge.ts       # Event bridge
│   ├── hybridVoiceAgent.ts            # High-level API + React hook
│   └── voiceAgentHybrid.ts            # Backward compatibility
├── components/
│   ├── AgentActivityDashboard.tsx     # UI dashboard
│   └── AgentActivityDashboard.css     # Styling
└── ...
```

---

## 🎨 Customization

### Change Voice

```typescript
const agent = await createHybridVoiceAgent({
  tools: { ... },
  voice: 'nova', // Try: alloy, echo, fable, onyx, nova, shimmer
});
```

### Add Custom Event Handlers

```typescript
const agent = await createHybridVoiceAgent({
  tools: { ... },
  onBackendEvent: (event) => {
    console.log('Backend event:', event);
    // Custom logic here
  },
});
```

### Access Advanced Features

```typescript
const agent = await createHybridVoiceAgent({ ... });

// Get the underlying bridge
const bridge = agent.getBridge();

// Get the call graph
const callGraph = agent.getCallGraph();

// Get scratchpads
const scratchpads = agent.getScratchpads();

// Subscribe to raw events
bridge.getEventStream().subscribe((event) => {
  console.log('Raw event:', event);
});
```

---

## 🐛 Troubleshooting

### Issue: Voice agent not responding

**Solution**: Check that you're connected:

```typescript
if (!agent.isAgentConnected()) {
  console.error('Agent not connected!');
  await agent.connect();
}
```

### Issue: Dashboard not updating

**Solution**: Make sure you're passing the event handler:

```typescript
const agent = await createHybridVoiceAgent({
  tools: { ... },
  onUIDashboardEvent: (event) => {
    setDashboardEvents(prev => [...prev, event]); // ← Must update state
  },
});
```

### Issue: Backend events not streaming

**Solution**: Check that streaming is enabled:

```typescript
// In backendRuntime.ts, make sure stream: true
const result = await runBackendAgent(bundle, userInput, { stream: true });
```

---

## 📚 Next Steps

1. **Read the full documentation**: `HYBRID_AGENT_ARCHITECTURE.md`
2. **See the implementation summary**: `IMPLEMENTATION_SUMMARY.md`
3. **Try the examples**: Run the code snippets above
4. **Customize the UI**: Modify `AgentActivityDashboard.tsx` and `.css`
5. **Deploy to production**: Move backend to Azure Functions

---

## 🎉 You're Ready!

You now have a complete hybrid agent architecture with:
- ✅ Backend processing (gpt-5-mini)
- ✅ Voice narration (gpt-realtime-mini)
- ✅ Real-time UI dashboard
- ✅ Event streaming
- ✅ React integration

**Start building!** 🚀

