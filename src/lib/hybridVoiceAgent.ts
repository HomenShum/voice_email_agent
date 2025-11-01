/**
 * Hybrid Voice Agent - Complete Integration Example
 *
 * This module demonstrates how to integrate the hybrid agent architecture:
 *
 * 1. Backend Processing Layer (Agent + gpt-5-mini)
 *    - RouterAgent delegates to specialists
 *    - Specialists execute tools and process data
 *    - Emits lifecycle events for real-time updates
 *
 * 2. Voice Narration Layer (RealtimeAgent + gpt-realtime-mini)
 *    - Provides immediate voice acknowledgments
 *    - Narrates backend processing steps asynchronously
 *    - Streams final voice summary to user
 *
 * 3. UI Dashboard Layer (React Component)
 *    - Displays hierarchical agent activity tree
 *    - Shows tool calls with parameters and results
 *    - Live status indicators for all operations
 *
 * Usage:
 *
 * ```typescript
 * import { createHybridVoiceAgent } from './lib/hybridVoiceAgent';
 *
 * const agent = await createHybridVoiceAgent({
 *   tools: { email, insights, contacts, calendar, sync },
 *   voice: 'alloy',
 *   onUIDashboardEvent: (event) => {
 *     // Update React UI state
 *     setDashboardEvents(prev => [...prev, event]);
 *   },
 * });
 *
 * // Process user request
 * const result = await agent.processRequest('Show me my recent emails');
 * ```
 */

import type { Tool } from '@openai/agents-core';
import {
  createHybridAgentBridge,
  type HybridAgentBridgeConfig,
  type HybridAgentBridge,
} from './agents/hybridAgentBridge';
import type { UIDashboardEvent } from './agents/backendRuntime';
import type { BackendAgentEvent } from './agents/backendRouterAgent';

// ============================================================================
// Hybrid Voice Agent Configuration
// ============================================================================

export interface HybridVoiceAgentConfig {
  // Tool configuration
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

  // API configuration
  apiBaseUrl?: string;
}

// ============================================================================
// Hybrid Voice Agent
// ============================================================================

export class HybridVoiceAgent {
  private bridge: HybridAgentBridge;
  private config: HybridVoiceAgentConfig;
  private apiKey: string | null = null;
  private isConnected = false;

  constructor(config: HybridVoiceAgentConfig) {
    this.config = config;

    // Create the hybrid bridge
    const bridgeConfig: HybridAgentBridgeConfig = {
      tools: config.tools,
      voice: config.voice,
      onProgress: config.onProgress,
      onTranscript: config.onTranscript,
      onUIDashboardEvent: config.onUIDashboardEvent,
      onBackendEvent: config.onBackendEvent,
    };

    this.bridge = createHybridAgentBridge(bridgeConfig);
  }

  /**
   * Connect to the OpenAI Realtime API
   *
   * This fetches an ephemeral API key from your backend and connects
   * the voice narration layer.
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      console.warn('[hybridVoiceAgent] Already connected');
      return;
    }

    // Fetch ephemeral API key from backend
    const apiBaseUrl = this.config.apiBaseUrl || (import.meta as any).env?.VITE_API_BASE || 'http://localhost:8787';
    const response = await fetch(`${apiBaseUrl}/api/realtime/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-realtime-mini' }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ephemeral API key: ${response.statusText}`);
    }

    const data = await response.json();
    this.apiKey = data.client_secret?.value || data.value;

    if (!this.apiKey) {
      throw new Error('No API key returned from backend');
    }

    // Connect voice narration layer
    await this.bridge.connectVoice(this.apiKey);
    this.isConnected = true;

    console.log('[hybridVoiceAgent] Connected successfully');
  }

  /**
   * Disconnect from the OpenAI Realtime API
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      console.warn('[hybridVoiceAgent] Not connected');
      return;
    }

    await this.bridge.disconnectVoice();
    this.isConnected = false;
    this.apiKey = null;

    console.log('[hybridVoiceAgent] Disconnected');
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
   *
   * @param userInput - The user's request (text or transcribed speech)
   * @returns The final result from the backend processing
   */
  async processRequest(userInput: string): Promise<any> {
    if (!this.isConnected) {
      throw new Error('Agent not connected. Call connect() first.');
    }

    console.log('[hybridVoiceAgent] Processing request:', userInput);

    // Process through the hybrid bridge
    const result = await this.bridge.processUserRequest(userInput);

    console.log('[hybridVoiceAgent] Request complete');
    return result;
  }

  /**
   * Check if the agent is connected
   */
  isAgentConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get the underlying bridge (for advanced usage)
   */
  getBridge(): HybridAgentBridge {
    return this.bridge;
  }

  /**
   * Get the call graph (for UI visualization)
   */
  getCallGraph() {
    return this.bridge.getCallGraph();
  }

  /**
   * Get scratchpads (for debugging)
   */
  /**
   * Narration policy & task controls
   */
  setNarrationMode(mode: 'serialize' | 'prioritize'): void {
    this.bridge.setNarrationMode(mode);
  }

  pauseNarration(): void {
    this.bridge.pauseNarration();
  }

  async resumeNarration(): Promise<void> {
    await this.bridge.resumeNarration();
  }

  prioritizeLatest(): void {
    this.bridge.prioritizeLatest();
  }

  prioritizeTask(taskId: string): void {
    this.bridge.prioritizeTask(taskId);
  }

  getTasks(): Array<{ id: string; input: string; status: string; createdAt: number; completedAt?: number }> {
    return this.bridge.getTasks();
  }

  async deliverPendingSummaries(): Promise<void> {
    await this.bridge.deliverPendingSummaries();
  }

  getScratchpads() {
    return this.bridge.getScratchpads();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create and connect a hybrid voice agent
 *
 * This is a convenience function that creates the agent and connects it
 * to the OpenAI Realtime API in one step.
 *
 * @param config - Configuration for tools, voice, and event handlers
 * @returns A connected HybridVoiceAgent instance
 */
export async function createHybridVoiceAgent(config: HybridVoiceAgentConfig): Promise<HybridVoiceAgent> {
  const agent = new HybridVoiceAgent(config);
  await agent.connect();
  return agent;
}

// ============================================================================
// React Hook removed for library build stability
// ============================================================================
// To keep this package framework-agnostic and avoid adding React as a hard
// dependency, the useHybridVoiceAgent hook has been removed from the library.
//
// If you need a React hook, create one inside your app and delegate to the
// exported factory APIs:
//   - createHybridVoiceAgent(config)
//   - createHybridVoiceSession()
//
// Example skeleton:
// export function useHybridVoiceAgent(config: HybridVoiceAgentConfig) {
//   const [agent, setAgent] = useState<HybridVoiceAgent | null>(null);
//   useEffect(() => { (async () => setAgent(await createHybridVoiceAgent(config)))() }, []);
//   return { agent };
// }

