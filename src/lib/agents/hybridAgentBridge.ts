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

  constructor(config: HybridAgentBridgeConfig) {
    this.config = config;
    this.eventStream = new BackendEventStream();

    // Create backend runtime
    const backendConfig: BackendRuntimeConfig = {
      tools: config.tools,
      onProgress: config.onProgress,
      onEvent: (event) => {
        // Forward to event stream
        this.eventStream.emit(event);

        // Forward to custom handler if provided
        config.onBackendEvent?.(event);
      },
    };

    this.backendBundle = createBackendRuntime(backendConfig);

    // Subscribe to backend events for voice narration
    this.eventStream.subscribe(async (event) => {
      if (this.voiceSession && this.voiceSession.isConnected()) {
        await this.voiceSession.receiveBackendEvent(event);
      }
    });

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

    // Step 1: Immediate voice acknowledgment
    if (this.voiceSession && this.voiceSession.isConnected()) {
      await this.voiceSession.acknowledgeRequest(userInput);
    }

    // Step 2: Run backend processing with event streaming
    const result = await runBackendAgent(this.backendBundle, userInput, {
      stream: true,
      onEvent: (event) => {
        // Events are automatically forwarded to voice and UI via eventStream
        console.debug('[hybridBridge] Backend event:', event.type);
      },
    });

    // Step 3: Provide final voice summary
    if (this.voiceSession && this.voiceSession.isConnected()) {
      await this.voiceSession.provideFinalSummary(result);
    }

    console.log('[hybridBridge] Request processing complete');
    return result;
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

