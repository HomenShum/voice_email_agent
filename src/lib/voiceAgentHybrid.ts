/**
 * Voice Agent - Hybrid Architecture Integration
 * 
 * This is a drop-in replacement for the existing voiceAgent.ts that uses
 * the new hybrid architecture:
 * 
 * - Backend processing with standard Agent (gpt-5-mini)
 * - Voice narration with RealtimeAgent (gpt-realtime-mini)
 * - Real-time UI dashboard updates
 * - Event streaming between layers
 * 
 * Migration Guide:
 * 
 * OLD (voiceAgent.ts):
 * ```typescript
 * import { createVoiceSession } from './lib/voiceAgent';
 * const session = await createVoiceSession();
 * ```
 * 
 * NEW (voiceAgentHybrid.ts):
 * ```typescript
 * import { createHybridVoiceSession } from './lib/voiceAgentHybrid';
 * const session = await createHybridVoiceSession();
 * ```
 */

import { createHybridVoiceAgent, type HybridVoiceAgentConfig } from './hybridVoiceAgent';
import {
  emailOpsToolset,
  insightToolset,
  contactsToolset,
  calendarToolset,
  syncToolset,
  type ToolCallRecord,
} from './tools';
import type { UIDashboardEvent } from './agents/backendRuntime';
import type { BackendAgentEvent } from './agents/backendRouterAgent';

// ============================================================================
// Global State (matches existing voiceAgent.ts API)
// ============================================================================

const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:8787';

let onTranscript: undefined | ((history: unknown[]) => void);
let onRouterProgress: undefined | ((message: string) => void);
let onDashboardEvent: undefined | ((event: UIDashboardEvent) => void);

export function setTranscriptHandler(fn: (history: unknown[]) => void) {
  onTranscript = fn;
}

export function setRouterProgressHandler(fn: (message: string) => void) {
  onRouterProgress = fn;
}

export function setDashboardEventHandler(fn: (event: UIDashboardEvent) => void) {
  onDashboardEvent = fn;
}

// ============================================================================
// Hybrid Voice Session Factory
// ============================================================================

/**
 * Create a hybrid voice session (drop-in replacement for createVoiceSession)
 * 
 * This creates a session that:
 * 1. Uses standard Agent (gpt-5-mini) for backend processing
 * 2. Uses RealtimeAgent (gpt-realtime-mini) for voice I/O only
 * 3. Streams events to UI dashboard in real-time
 * 4. Provides asynchronous voice narration of backend progress
 */
export async function createHybridVoiceSession() {
  console.log('[voiceAgentHybrid] Creating hybrid voice session...');

  // Create the hybrid agent configuration
  const config: HybridVoiceAgentConfig = {
    tools: {
      email: Array.from(emailOpsToolset),
      insights: Array.from(insightToolset),
      contacts: Array.from(contactsToolset),
      calendar: Array.from(calendarToolset),
      sync: Array.from(syncToolset),
    },
    voice: 'alloy',
    apiBaseUrl: API_BASE,

    // Progress handler (backend processing updates)
    onProgress: (message) => {
      console.debug('[voiceAgentHybrid] Progress:', message);
      try {
        onRouterProgress?.(message);
      } catch (error) {
        console.warn('[voiceAgentHybrid] Progress handler failed:', error);
      }
    },

    // Transcript handler (voice conversation history)
    onTranscript: (history) => {
      console.debug('[voiceAgentHybrid] Transcript updated:', history);
      try {
        onTranscript?.(history);
      } catch (error) {
        console.warn('[voiceAgentHybrid] Transcript handler failed:', error);
      }
    },

    // UI Dashboard event handler
    onUIDashboardEvent: (event) => {
      console.debug('[voiceAgentHybrid] Dashboard event:', event.type);
      try {
        onDashboardEvent?.(event);
      } catch (error) {
        console.warn('[voiceAgentHybrid] Dashboard event handler failed:', error);
      }
    },

    // Backend event handler (for debugging)
    onBackendEvent: (event) => {
      console.debug('[voiceAgentHybrid] Backend event:', event.type);
    },
  };

  // Create and connect the hybrid agent
  const agent = await createHybridVoiceAgent(config);

  console.log('[voiceAgentHybrid] Hybrid voice session created successfully');

  // Return a session-like object that matches the existing API
  return {
    agent,
    
    // Process user input (matches existing session API)
    async processInput(userInput: string) {
      return await agent.processRequest(userInput);
    },

    // Disconnect (matches existing session API)
    async disconnect() {
      return await agent.disconnect();
    },

    // Check connection status
    isConnected() {
      return agent.isAgentConnected();
    },

    // Get call graph for debugging
    getCallGraph() {
      return agent.getCallGraph();
    },

    // Get scratchpads for debugging
    getScratchpads() {
      return agent.getScratchpads();
    },

    // Get the underlying bridge for advanced usage
    getBridge() {
      return agent.getBridge();
    },
  };
}

// ============================================================================
// Compatibility Layer (for existing code)
// ============================================================================

/**
 * Create a voice session (legacy API - redirects to hybrid implementation)
 * 
 * This maintains backward compatibility with existing code that uses:
 * ```typescript
 * import { createVoiceSession } from './lib/voiceAgent';
 * const session = await createVoiceSession();
 * ```
 */
export async function createVoiceSession() {
  console.warn('[voiceAgentHybrid] Using legacy createVoiceSession() - consider migrating to createHybridVoiceSession()');
  return await createHybridVoiceSession();
}

// ============================================================================
// Event Formatters (for UI integration)
// ============================================================================

/**
 * Format backend events for the existing tool call history UI
 * 
 * This converts UIDashboardEvent to ToolCallRecord for backward compatibility
 */
export function formatDashboardEventAsToolCall(event: UIDashboardEvent): ToolCallRecord | null {
  if (event.type !== 'tool') {
    return null;
  }

  return {
    id: event.id,
    name: event.toolName || 'unknown',
    timestamp: event.timestamp,
    agentId: event.agentId,
    parameters: event.parameters || {},
    result: event.result,
    error: event.status === 'error' ? 'Tool execution failed' : undefined,
  };
}

/**
 * Format backend events for the existing router progress UI
 */
export function formatBackendEventAsProgress(event: BackendAgentEvent): string {
  switch (event.type) {
    case 'agent_started':
      return `[${event.agentName}] Starting...`;
    case 'agent_completed':
      return `[${event.agentName}] Completed`;
    case 'agent_handoff':
      return `[RouterAgent] Delegating to ${event.toAgent}`;
    case 'tool_started':
      return `[${event.agentId}] Calling ${event.toolName}...`;
    case 'tool_completed':
      return `[${event.agentId}] ${event.toolName} completed`;
    case 'progress_update':
      return event.message;
    default:
      return '';
  }
}

// ============================================================================
// Migration Utilities
// ============================================================================

/**
 * Check if the hybrid architecture is available
 */
export function isHybridArchitectureAvailable(): boolean {
  try {
    // Check if required modules are available
    return typeof createHybridVoiceAgent === 'function';
  } catch {
    return false;
  }
}

/**
 * Get architecture information
 */
export function getArchitectureInfo() {
  return {
    type: 'hybrid',
    backendModel: 'gpt-5-mini',
    voiceModel: 'gpt-realtime-mini',
    features: [
      'Backend processing with standard Agent',
      'Voice narration with RealtimeAgent',
      'Real-time UI dashboard updates',
      'Event streaming between layers',
      'Asynchronous voice narration',
      'Hierarchical agent activity visualization',
    ],
  };
}

// ============================================================================
// Usage Example
// ============================================================================

/*
// Example 1: Basic usage (drop-in replacement)
import { createHybridVoiceSession, setTranscriptHandler, setRouterProgressHandler } from './lib/voiceAgentHybrid';

setTranscriptHandler((history) => {
  console.log('Transcript:', history);
});

setRouterProgressHandler((message) => {
  console.log('Progress:', message);
});

const session = await createHybridVoiceSession();
const result = await session.processInput('Show me my recent emails');
console.log('Result:', result);

// Example 2: With UI dashboard
import { createHybridVoiceSession, setDashboardEventHandler } from './lib/voiceAgentHybrid';
import { AgentActivityDashboard } from './components/AgentActivityDashboard';

function VoiceAgentUI() {
  const [dashboardEvents, setDashboardEvents] = React.useState([]);

  React.useEffect(() => {
    setDashboardEventHandler((event) => {
      setDashboardEvents(prev => [...prev, event]);
    });
  }, []);

  return (
    <div>
      <AgentActivityDashboard events={dashboardEvents} />
    </div>
  );
}

// Example 3: Advanced usage with direct bridge access
const session = await createHybridVoiceSession();
const bridge = session.getBridge();
const callGraph = session.getCallGraph();
const scratchpads = session.getScratchpads();

// Subscribe to raw backend events
bridge.getEventStream().subscribe((event) => {
  console.log('Raw backend event:', event);
});
*/

