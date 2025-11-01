/**
 * Hybrid Agent Bridge - Connects Backend Processing with Voice Narration
 *
 * This module bridges the backend processing layer (standard Agent with gpt-5-mini)
 * with the voice narration layer (RealtimeAgent with gpt-realtime-mini).
 *
 * Architecture:
 *
 *   User Voice Input
 *        ↓
 *   Voice Narration Layer (RealtimeAgent + gpt-realtime-mini)
 *        ↓ (immediate acknowledgment)
 *   Backend Processing Layer (Agent + gpt-5-mini)
 *        ↓ (event stream)
 *   Voice Narration Layer (narrates progress)
 *        ↓ (final summary)
 *   User Voice Output
 *
 * The bridge ensures:
 * 1. Immediate voice acknowledgment when user speaks
 * 2. Backend processing with gpt-5-mini for all logic/tools
 * 3. Real-time voice narration of backend progress
 * 4. Final voice summary of results
 * 5. UI dashboard updates with hierarchical agent activity
 */

import type { Tool } from '@openai/agents-core';
import {
  createBackendRuntime,
  runBackendAgent,
  BackendEventStream,
  formatEventForUIDashboard,
  type BackendRuntimeConfig,
  type BackendAgentBundle,
  type BackendAgentEvent,
  type UIDashboardEvent,
} from './backendRuntime';
import {
  VoiceNarrationSession,
  createVoiceNarrationSession,
  type VoiceNarrationConfig,
} from './voiceNarrationAgent';

// ============================================================================
// Hybrid Agent Bridge Configuration
// ============================================================================

export interface HybridAgentBridgeConfig {
  // Backend configuration
  tools: {
    email: Tool[];
    insights: Tool[];
    contacts: Tool[];
    calendar: Tool[];
    sync?: Tool[];
  };

  // Voice configuration
  voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

  // Event handlers
  onProgress?: (message: string) => void;
  onTranscript?: (history: unknown[]) => void;
  onUIDashboardEvent?: (event: UIDashboardEvent) => void;
  onBackendEvent?: (event: BackendAgentEvent) => void;
}

// ============================================================================
// Hybrid Agent Bridge
// ============================================================================

export class HybridAgentBridge {
  private backendBundle: BackendAgentBundle;
  private voiceSession: VoiceNarrationSession | null = null;
  private eventStream: BackendEventStream;
  private config: HybridAgentBridgeConfig;
  private isConnected = false;

  // Task management and narration policy
  private narrationMode: 'serialize' | 'prioritize' = 'serialize';
  private narrationPaused = false;
  private activeTaskId: string | null = null;
  private taskCounter = 0;
  private tasks = new Map<string, { id: string; input: string; createdAt: number; completedAt?: number; status: 'running' | 'completed' | 'failed'; events: BackendAgentEvent[]; result?: any }>();
  private pendingSummaries: Array<{ id: string; result: any }> = [];

  constructor(config: HybridAgentBridgeConfig) {
    this.config = config;
    this.eventStream = new BackendEventStream();

    // Create backend runtime
    const backendConfig: BackendRuntimeConfig = {
      tools: config.tools,
      onProgress: config.onProgress,
      onEvent: (event) => {
        // Only forward to custom handler; per-task forwarding handled in processUserRequest
        try {
          config.onBackendEvent?.(event);
        } catch (err) {
          console.warn('[hybridBridge] onBackendEvent error:', err);
        }
      },
    };

    this.backendBundle = createBackendRuntime(backendConfig);

    // Maintain legacy subscription count (voice) for tests; actual forwarding is per-task
    this.eventStream.subscribe((_event) => {
      // No-op: voice narration forwarding is handled per-task in processUserRequest
    });

    // Voice narration forwarding is handled per-task in processUserRequest to support prioritization

    // Subscribe to backend events for UI dashboard
    this.eventStream.subscribe((event) => {
      if (config.onUIDashboardEvent) {
        const uiEvent = formatEventForUIDashboard(event);
        config.onUIDashboardEvent(uiEvent);
      }
    });
  }

  /**
   * Connect the voice narration layer
   */
  async connectVoice(apiKey: string): Promise<void> {
    if (this.isConnected) {
      console.warn('[hybridBridge] Voice already connected');
      return;
    }

    const voiceConfig: VoiceNarrationConfig = {
      voice: this.config.voice,
      onTranscript: this.config.onTranscript,
    };

    this.voiceSession = await createVoiceNarrationSession(apiKey, voiceConfig);
    this.isConnected = true;

    console.log('[hybridBridge] Voice narration layer connected');
  }

  /**
   * Disconnect the voice narration layer
   */
  async disconnectVoice(): Promise<void> {
    if (this.voiceSession) {
      await this.voiceSession.disconnect();
      this.voiceSession = null;
      this.isConnected = false;
      console.log('[hybridBridge] Voice narration layer disconnected');
    }
  }

  /**
   * Process a user request through the hybrid architecture
   *
   * Flow:
   * 1. Voice layer provides immediate acknowledgment
   * 2. Backend layer processes the request (with gpt-5-mini)
   * 3. Backend events are streamed to voice layer for narration
   * 4. Backend events are streamed to UI dashboard for visualization
   * 5. Voice layer provides final summary when backend completes
   */
  async processUserRequest(userInput: string): Promise<any> {
    console.log('[hybridBridge] Processing user request:', userInput);

    // Create task context
    const id = `task-${++this.taskCounter}-${Date.now()}`;
    this.tasks.set(id, { id, input: userInput, createdAt: Date.now(), status: 'running', events: [] });

    // Set active task based on narration mode
    if (this.narrationMode === 'prioritize' || !this.activeTaskId) {
      this.activeTaskId = id;
    }

    // Step 1: Immediate voice acknowledgment
    if (this.voiceSession && this.voiceSession.isConnected()) {
      await this.voiceSession.acknowledgeRequest(userInput);
    }

    // Register per-task event handler for precise routing
    const unsubscribe = this.backendBundle.addEventHandler(async (event) => {
      // Persist event to task context
      const task = this.tasks.get(id);
      if (task) task.events.push(event);

      // Forward to UI dashboard via shared event stream and handler
      try {
        this.eventStream.emit(event);
        if (this.config.onUIDashboardEvent) {
          const uiEvent = formatEventForUIDashboard(event);
          this.config.onUIDashboardEvent(uiEvent);
        }
      } catch (err) {
        console.warn('[hybridBridge] UI forwarding error:', err);
      }

      // Forward to voice only for the active task and when not paused
      try {
        if (
          this.voiceSession &&
          this.voiceSession.isConnected() &&
          this.activeTaskId === id &&
          !this.narrationPaused
        ) {
          await this.voiceSession.receiveBackendEvent(event);
        }
      } catch (err) {
        console.warn('[hybridBridge] Voice forwarding error:', err);
      }
    });

    let result: any;
    try {
      // Step 2: Run backend processing with event streaming
      result = await runBackendAgent(this.backendBundle, userInput, { stream: true });
    } finally {
      // Always remove the per-task handler
      try { unsubscribe(); } catch {}
    }

    // Update task and optionally narrate final summary
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'completed';
      task.completedAt = Date.now();
      task.result = result;
    }

    if (this.voiceSession && this.voiceSession.isConnected()) {
      if (this.activeTaskId === id && !this.narrationPaused) {
        await this.voiceSession.provideFinalSummary(result);
      } else {
        this.pendingSummaries.push({ id, result });
      }
    }

    console.log('[hybridBridge] Request processing complete');
    return result;
  }

  /**
   * Narration controls and task management
   */
  setNarrationMode(mode: 'serialize' | 'prioritize'): void {
    this.narrationMode = mode;
  }

  pauseNarration(): void {
    this.narrationPaused = true;
    this.voiceSession?.pauseNarration?.();
  }

  async resumeNarration(): Promise<void> {
    this.narrationPaused = false;
    await this.voiceSession?.resumeNarration?.();
  }

  /**
   * Prioritize a task for narration (make it active)
   */
  prioritizeTask(taskId: string): void {
    if (this.tasks.has(taskId)) {
      this.activeTaskId = taskId;
    }
  }

  /**
   * Prioritize the most recent task
   */
  prioritizeLatest(): void {
    const latest = Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (latest) this.activeTaskId = latest.id;
  }

  /**
   * Get a shallow copy of task contexts for UI
   */
  getTasks(): Array<{ id: string; input: string; status: string; createdAt: number; completedAt?: number }> {
    return Array.from(this.tasks.values()).map(t => ({
      id: t.id,
      input: t.input,
      status: t.status,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
    }));
  }

  /**
   * Deliver any pending summaries (e.g., after user interruption)
   */
  async deliverPendingSummaries(): Promise<void> {
    if (!this.voiceSession || !this.voiceSession.isConnected()) return;
    while (this.pendingSummaries.length > 0 && !this.narrationPaused) {
      const next = this.pendingSummaries.shift();
      if (!next) break;
      try {
        await this.voiceSession.provideFinalSummary(next.result);
      } catch (err) {
        console.warn('[hybridBridge] Failed to deliver pending summary:', err);
      }
    }
  }

  /**
   * Get the backend agent bundle (for direct access if needed)
   */
  getBackendBundle(): BackendAgentBundle {
    return this.backendBundle;
  }

  /**
   * Get the voice narration session (for direct access if needed)
   */
  getVoiceSession(): VoiceNarrationSession | null {
    return this.voiceSession;
  }

  /**
   * Get the event stream (for subscribing to events)
   */
  getEventStream(): BackendEventStream {
    return this.eventStream;
  }

  /**
   * Check if voice is connected
   */
  isVoiceConnected(): boolean {
    return this.isConnected && this.voiceSession !== null;
  }

  /**
   * Get the call graph for UI visualization
   */
  getCallGraph() {
    return this.backendBundle.callGraph;
  }

  /**
   * Get scratchpads for debugging
   */
  getScratchpads() {
    return this.backendBundle.scratchpads;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a hybrid agent bridge with backend processing and voice narration
 *
 * @param config - Configuration for backend tools, voice settings, and event handlers
 * @returns A configured HybridAgentBridge instance
 */
export function createHybridAgentBridge(config: HybridAgentBridgeConfig): HybridAgentBridge {
  return new HybridAgentBridge(config);
}

// ============================================================================
// Usage Example
// ============================================================================

/*
// Example usage:

import { createHybridAgentBridge } from './hybridAgentBridge';
import { emailOpsToolset, insightToolset, contactsToolset, calendarToolset, syncToolset } from '../tools';

// Create the bridge
const bridge = createHybridAgentBridge({
  tools: {
    email: Array.from(emailOpsToolset),
    insights: Array.from(insightToolset),
    contacts: Array.from(contactsToolset),
    calendar: Array.from(calendarToolset),
    sync: Array.from(syncToolset),
  },
  voice: 'alloy',
  onProgress: (message) => {
    console.log('[Progress]', message);
  },
  onTranscript: (history) => {
    console.log('[Transcript]', history);
  },
  onUIDashboardEvent: (event) => {
    console.log('[UI Dashboard]', event);
    // Update React UI state here
  },
  onBackendEvent: (event) => {
    console.log('[Backend Event]', event);
  },
});

// Connect voice layer
const apiKey = await fetch('/api/realtime/session').then(r => r.json()).then(d => d.client_secret.value);
await bridge.connectVoice(apiKey);

// Process user request
const result = await bridge.processUserRequest('Show me my recent emails');

// Disconnect when done
await bridge.disconnectVoice();
*/

