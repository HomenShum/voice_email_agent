/**
 * Client-Side Voice Agent - Direct Router + Specialists Architecture
 *
 * This module implements a client-side router + specialists pattern where all
 * agent orchestration happens locally in the browser using OpenAI's Realtime API.
 *
 * Architecture:
 *
 * 1. Voice Input Layer (gpt-realtime)
 *    - User speaks to the voice agent
 *    - Real-time speech-to-text transcription
 *
 * 2. Router Agent (gpt-realtime, client-side)
 *    - Analyzes user intent
 *    - Delegates to appropriate specialist using handoffs
 *
 * 3. Specialist Agents (gpt-realtime, client-side)
 *    - EmailOpsAgent: Email search, triage, unread messages
 *    - InsightAgent: Email analytics and aggregations
 *    - ContactsAgent: Contact lookup via Nylas
 *    - CalendarAgent: Calendar events via Nylas
 *    - AutomationAgent: Automation capabilities
 *
 * 4. Tool Execution (server-side endpoints)
 *    - Each specialist calls secure Azure Functions endpoints
 *    - /api/search, /api/aggregate, /api/nylas/unread, etc.
 *    - All API keys and secrets stay on server
 *
 * 5. Voice Output Layer (gpt-realtime)
 *    - Real-time narration of progress and results
 *    - Text-to-speech synthesis
 *
 * Benefits:
 * - Lower latency (no extra hop to backend router)
 * - Better real-time experience (instant routing decisions)
 * - Reduced backend costs (no gpt-5-mini for routing)
 * - Voice-first design (direct handoffs between realtime agents)
 *
 * Usage:
 *
 * ```typescript
 * import { createHybridVoiceAgent } from './lib/hybridVoiceAgent';
 *
 * const agent = await createHybridVoiceAgent({
 *   tools: { email, insights, contacts, calendar, sync },
 *   voice: 'alloy',
 *   onProgress: (msg) => console.log(msg),
 *   onTranscript: (history) => updateUI(history),
 * });
 *
 * // Voice agent is now listening and will handle requests automatically
 * ```
 */

import type { Tool } from '@openai/agents-core';
import { createRouterBundle, type RouterDependencies, type RouterBundle } from './agents/routerAgent';
import { RealtimeSession } from '@openai/agents/realtime';

// ============================================================================
// Client-Side Voice Agent Configuration
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

  // API configuration
  apiBaseUrl?: string;
}

// ============================================================================
// Client-Side Voice Agent
// ============================================================================

export class HybridVoiceAgent {
  private routerBundle: RouterBundle | null = null;
  private session: RealtimeSession | null = null;
  private config: HybridVoiceAgentConfig;
  private apiKey: string | null = null;
  private isConnected = false;

  constructor(config: HybridVoiceAgentConfig) {
    this.config = config;
  }

  /**
   * Connect to the OpenAI Realtime API
   *
   * This creates the client-side router + specialists architecture and
   * connects to the OpenAI Realtime API for voice interaction.
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      console.warn('[clientVoiceAgent] Already connected');
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

    // Create router + specialists bundle
    const routerDeps: RouterDependencies = {
      tools: {
        email: this.config.tools.email,
        insights: this.config.tools.insights,
        contacts: this.config.tools.contacts,
        calendar: this.config.tools.calendar,
        sync: this.config.tools.sync,
      },
      onProgress: this.config.onProgress,
    };

    this.routerBundle = createRouterBundle(routerDeps);

    // Create realtime session with router agent
    this.session = new RealtimeSession(this.routerBundle.router, {
      transport: 'webrtc',
      // Configure voice via session config; model is provided on connect()
      config: {
        voice: this.config.voice || 'alloy',
      },
    });

    // Set up transcript handler (use history_updated event)
    if (this.config.onTranscript) {
      this.session.on('history_updated', (history) => {
        this.config.onTranscript?.(history as unknown[]);
      });
    }

    // Set up error handlers to prevent unexpected disconnections
    // Use type assertion to bypass strict typing for error events
    (this.session as any).on?.('error', (error: any) => {
      console.error('[clientVoiceAgent] Session error:', error);
      // Don't disconnect on errors - let the session recover
    });

    (this.session as any).on?.('close', () => {
      console.warn('[clientVoiceAgent] Session closed');
      this.isConnected = false;
    });

    // Connect to OpenAI Realtime API
    await this.session.connect({
      apiKey: this.apiKey!,
      model: 'gpt-realtime-mini',
    });
    this.isConnected = true;

    console.log('[clientVoiceAgent] Connected successfully with client-side router + specialists');
  }

  /**
   * Disconnect from the OpenAI Realtime API
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      console.warn('[clientVoiceAgent] Not connected');
      return;
    }

    if (this.session) {
      this.session.close();
      this.session = null;
    }

    this.routerBundle = null;
    this.isConnected = false;
    this.apiKey = null;

    console.log('[clientVoiceAgent] Disconnected');
  }

  /**
   * Send a text message to the voice agent
   *
   * This is useful for testing or when you want to send a text request
   * instead of using voice input.
   *
   * @param text - The text message to send
   */
  async sendText(text: string): Promise<void> {
    if (!this.isConnected || !this.session) {
      throw new Error('Agent not connected. Call connect() first.');
    }

    console.log('[clientVoiceAgent] Sending text:', text);

    try {
      // Step 1: Add the user message to the conversation
      // Use the session's send method to send a conversation.item.create event
      await (this.session as any).send({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: text,
            },
          ],
        },
      });

      // Step 2: Trigger a response from the agent
      // This is critical - without this, the agent won't respond
      await (this.session as any).send({
        type: 'response.create',
      });

      console.log('[clientVoiceAgent] Text message sent and response triggered');
    } catch (error) {
      console.error('[clientVoiceAgent] Error sending text:', error);
      throw error;
    }
  }

  /**
   * Check if the agent is connected
   */
  isAgentConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get the realtime session (for advanced usage)
   */
  getSession(): RealtimeSession | null {
    return this.session;
  }

  /**
   * Get the router bundle (for debugging)
   */
  getRouterBundle(): RouterBundle | null {
    return this.routerBundle;
  }

  /**
   * Get the call graph (for UI visualization)
   */
  getCallGraph() {
    return this.routerBundle?.runtime.router.callGraph || null;
  }

  /**
   * Get scratchpads (for debugging)
   */
  getScratchpads() {
    return this.routerBundle?.runtime.router.scratchpads || {};
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create and connect a client-side voice agent with router + specialists
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

