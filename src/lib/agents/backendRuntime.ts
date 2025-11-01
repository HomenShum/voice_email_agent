/**
 * Backend Runtime - Manages backend Agent execution and event streaming
 * 
 * This module creates and manages the backend processing layer using standard Agent (gpt-5-mini).
 * It provides:
 * 1. Event streaming to voice narration layer
 * 2. Event streaming to UI dashboard
 * 3. Lifecycle management for all backend agents
 */

import { Agent, run } from '@openai/agents';
import type { Tool } from '@openai/agents-core';
import { CallGraph } from './callGraph';
import { Scratchpad } from './scratchpad';
import {
  createBackendRouterAgent,
  createBackendEmailOpsAgent,
  createBackendInsightAgent,
  createBackendContactsAgent,
  createBackendCalendarAgent,
  createBackendAutomationAgent,
  SPECIALIST_IDS,
  DISPLAY_NAMES,
  type BackendAgentEvent,
  type BackendEventHandler,
  type BackendSpecialistEnvironment,
  type BackendRouterEnvironment,
} from './backendRouterAgent';

// Re-export backend types for consumers of backendRuntime
export type {
  BackendAgentEvent,
  BackendEventHandler,
  BackendSpecialistEnvironment,
  BackendRouterEnvironment,
} from './backendRouterAgent';

// ============================================================================
// Backend Runtime Configuration
// ============================================================================

export interface BackendRuntimeConfig {
  tools: {
    email: Tool[];
    insights: Tool[];
    contacts: Tool[];
    calendar: Tool[];
    sync?: Tool[];
  };
  onProgress?: (message: string) => void;
  onEvent?: BackendEventHandler;
}

export interface BackendAgentBundle {
  router: Agent;
  specialists: Record<(typeof SPECIALIST_IDS)[number], Agent>;
  callGraph: CallGraph;
  scratchpads: Record<string, Scratchpad>;
}

// ============================================================================
// Backend Runtime Factory
// ============================================================================

export function createBackendRuntime(config: BackendRuntimeConfig): BackendAgentBundle {
  const callGraph = new CallGraph();
  const scratchpads = new Map<string, Scratchpad>();
  const eventHandlers: BackendEventHandler[] = [];

  // Register event handlers
  if (config.onEvent) {
    eventHandlers.push(config.onEvent);
  }

  // Progress callback
  const progress = config.onProgress || (() => {});

  // Event emitter
  const emitEvent: BackendEventHandler = (event) => {
    eventHandlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.warn('[backendRuntime] Event handler error:', error);
      }
    });
  };

  // Scratchpad factory
  const ensureScratchpad = (id: string) => {
    if (!scratchpads.has(id)) {
      scratchpads.set(id, new Scratchpad());
    }
    return scratchpads.get(id)!;
  };

  // Create specialist environments
  const createSpecialistEnv = (id: (typeof SPECIALIST_IDS)[number]): BackendSpecialistEnvironment => ({
    id,
    name: DISPLAY_NAMES[id],
    scratchpad: ensureScratchpad(id),
    callGraph,
    progress,
    emitEvent,
  });

  // Create specialist agents
  const specialists: Record<(typeof SPECIALIST_IDS)[number], Agent> = {
    email_ops: createBackendEmailOpsAgent(createSpecialistEnv('email_ops'), config.tools.email),
    insights: createBackendInsightAgent(createSpecialistEnv('insights'), config.tools.insights),
    contacts: createBackendContactsAgent(createSpecialistEnv('contacts'), config.tools.contacts),
    calendar: createBackendCalendarAgent(createSpecialistEnv('calendar'), config.tools.calendar),
    automation: createBackendAutomationAgent(createSpecialistEnv('automation')),
  };

  // Create router environment
  const routerEnv: BackendRouterEnvironment = {
    id: 'router',
    name: 'RouterAgent',
    callGraph,
    scratchpads: new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop !== 'string') return undefined;
          return ensureScratchpad(prop);
        },
      },
    ) as Record<string, Scratchpad>,
    progress,
    emitEvent,
  };

  // Create router agent
  const router = createBackendRouterAgent(routerEnv, specialists);

  return {
    router,
    specialists,
    callGraph,
    scratchpads: Object.fromEntries(scratchpads),
  };
}

// ============================================================================
// Backend Agent Execution with Streaming
// ============================================================================

export interface BackendRunOptions {
  stream?: boolean;
  onEvent?: BackendEventHandler;
}

export interface BackendRuntimeDeps {
  runner?: typeof run;
}

/**
 * Run the backend agent with streaming support
 *
 * This function executes the backend RouterAgent and streams events to:
 * 1. Voice narration layer (for real-time voice feedback)
 * 2. UI dashboard (for visual progress tracking)
 *
 * @param bundle - The backend agent bundle
 * @param userInput - The user's request
 * @param options - Execution options (streaming, event handlers)
 * @param deps - Dependency injection for testing (runner function)
 * @returns The final result from the backend agent
 */
export async function runBackendAgent(
  bundle: BackendAgentBundle,
  userInput: string,
  options: BackendRunOptions = {},
  deps: BackendRuntimeDeps = {}
): Promise<any> {
  const { stream = true, onEvent } = options;
  const runner = deps.runner ?? run;

  // Register additional event handler if provided
  const eventHandlers: BackendEventHandler[] = [];
  if (onEvent) {
    eventHandlers.push(onEvent);
  }

  // Emit progress events
  const emitProgress = (agentId: string, message: string) => {
    const event: BackendAgentEvent = {
      type: 'progress_update',
      agentId,
      message,
      timestamp: Date.now(),
    };
    eventHandlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.warn('[runBackendAgent] Event handler error:', error);
      }
    });
  };

  if (stream) {
    // Run with streaming enabled
    emitProgress('router', 'Starting backend agent execution...');

    const streamResult = await runner(bundle.router, userInput, { stream: true });

    // Process streaming events
    for await (const event of streamResult) {
      console.debug('[backendRuntime] Stream event:', event.type);

      // Forward events to handlers
      if (event.type === 'agent_updated_stream_event') {
        const agentName = event.agent?.name || 'Unknown';
        emitProgress('router', `Agent switched to: ${agentName}`);
      } else if (event.type === 'run_item_stream_event') {
        // Tool calls, outputs, etc.
        console.debug('[backendRuntime] Run item:', event.item);
      }
    }

    // Wait for completion
    await streamResult.completed;

    // Attempt to read the final text output from the stream in a version-tolerant way
    let finalText = '';
    try {
      const anyStream: any = streamResult as any;
      const textStream = anyStream.toTextStream
        ? anyStream.toTextStream({ compatibleWithNodeStreams: false })
        : null;

      if (textStream && typeof textStream.getReader === 'function') {
        const reader = textStream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (typeof value === 'string') finalText += value;
        }
      } else if (anyStream.result?.finalOutput) {
        // Some library versions expose the final RunResult on `result`
        finalText = anyStream.result.finalOutput;
      }
    } catch (err) {
      console.warn('[backendRuntime] Failed to read text stream:', err);
    }

    const finalResult = { finalOutput: finalText };

    emitProgress('router', 'Backend agent execution complete.');
    console.debug('[backendRuntime] Final result:', finalResult);

    return finalResult;
  } else {
    // Run without streaming
    emitProgress('router', 'Starting backend agent execution...');
    const result = await run(bundle.router, userInput);
    emitProgress('router', 'Backend agent execution complete.');
    return result;
  }
}

// ============================================================================
// Event Stream Utilities
// ============================================================================

/**
 * Create a readable stream of backend events
 * 
 * This can be used to pipe events to:
 * 1. Voice narration layer (WebSocket/Server-Sent Events)
 * 2. UI dashboard (WebSocket/Server-Sent Events)
 */
export class BackendEventStream {
  private handlers: BackendEventHandler[] = [];

  subscribe(handler: BackendEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.indexOf(handler);
      if (index > -1) {
        this.handlers.splice(index, 1);
      }
    };
  }

  emit(event: BackendAgentEvent): void {
    this.handlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.warn('[BackendEventStream] Handler error:', error);
      }
    });
  }

  get handlerCount(): number {
    return this.handlers.length;
  }
}

// ============================================================================
// Voice Narration Event Formatter
// ============================================================================

/**
 * Format backend events into voice-friendly narration messages
 * 
 * These messages are sent to the voice narration layer (RealtimeAgent)
 * for asynchronous voice feedback to the user.
 */
export function formatEventForVoiceNarration(event: BackendAgentEvent): string {
  switch (event.type) {
    case 'agent_started':
      return `I'm routing your request to the ${event.agentName}...`;

    case 'agent_handoff':
      return `Delegating to ${event.toAgent}...`;

    case 'tool_started':
      const params = event.parameters
        ? Object.entries(event.parameters)
            .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
            .join(', ')
        : 'no parameters';
      return `The agent is now calling the ${event.toolName} tool with ${params}...`;

    case 'tool_completed':
      return `Tool ${event.toolName} completed successfully.`;

    case 'agent_completed':
      return `Processing complete. Let me summarize the results...`;

    case 'progress_update':
      return event.message;

    default:
      return '';
  }
}

// ============================================================================
// UI Dashboard Event Formatter
// ============================================================================

/**
 * Format backend events into UI-friendly data structures
 * 
 * These are sent to the React UI dashboard for visual display.
 */
export interface UIDashboardEvent {
  id: string;
  type: 'agent' | 'tool' | 'handoff' | 'progress';
  agentId: string;
  agentName?: string;
  toolName?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'error';
  timestamp: number;
  parameters?: any;
  result?: any;
  message?: string;
}

export function formatEventForUIDashboard(event: BackendAgentEvent): UIDashboardEvent {
  const baseId = `${event.timestamp}-${Math.random().toString(36).substr(2, 9)}`;

  switch (event.type) {
    case 'agent_started':
      return {
        id: baseId,
        type: 'agent',
        agentId: event.agentId,
        agentName: event.agentName,
        status: 'in-progress',
        timestamp: event.timestamp,
      };

    case 'agent_completed':
      return {
        id: baseId,
        type: 'agent',
        agentId: event.agentId,
        agentName: event.agentName,
        status: 'completed',
        timestamp: event.timestamp,
        result: event.output,
      };

    case 'agent_handoff':
      return {
        id: baseId,
        type: 'handoff',
        agentId: 'router',
        agentName: event.toAgent,
        status: 'in-progress',
        timestamp: event.timestamp,
        message: `Delegating from ${event.fromAgent} to ${event.toAgent}`,
      };

    case 'tool_started':
      return {
        id: baseId,
        type: 'tool',
        agentId: event.agentId,
        toolName: event.toolName,
        status: 'in-progress',
        timestamp: event.timestamp,
        parameters: event.parameters,
      };

    case 'tool_completed':
      return {
        id: baseId,
        type: 'tool',
        agentId: event.agentId,
        toolName: event.toolName,
        status: 'completed',
        timestamp: event.timestamp,
        result: event.result,
      };

    case 'progress_update':
      return {
        id: baseId,
        type: 'progress',
        agentId: event.agentId,
        status: 'in-progress',
        timestamp: event.timestamp,
        message: event.message,
      };

    default:
      return {
        id: baseId,
        type: 'progress',
        agentId: 'unknown',
        status: 'in-progress',
        timestamp: Date.now(),
        message: 'Unknown event',
      };
  }
}

