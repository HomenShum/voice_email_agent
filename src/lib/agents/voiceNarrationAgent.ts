/**
 * Voice Narration Layer - RealtimeAgent for Voice I/O Only
 *
 * This module implements the voice interface using RealtimeAgent (gpt-realtime-mini).
 * It does NOT perform any backend processing - it only:
 * 1. Receives backend events from the processing layer
 * 2. Narrates what's happening in real-time to the user
 * 3. Provides immediate voice acknowledgments
 * 4. Streams voice responses based on backend results
 *
 * The actual data processing, tool execution, and decision-making happens
 * in the backend layer (backendRouterAgent.ts) using standard Agent with gpt-5-mini.
 */

import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';
import type { BackendAgentEvent } from './backendRouterAgent';
import { formatEventForVoiceNarration } from './backendRuntime';

// ============================================================================
// Voice Narration Configuration
// ============================================================================

const VOICE_MODEL = 'gpt-realtime-mini'; // Realtime API model for voice I/O only

export interface VoiceNarrationConfig {
  voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  onTranscript?: (history: unknown[]) => void;
  onAudioDelta?: (delta: any) => void;
}

// ============================================================================
// Voice Narration Agent (RealtimeAgent with gpt-realtime-mini)
// ============================================================================

/**
 * Create a voice narration agent that narrates backend processing events
 *
 * This agent:
 * - Uses gpt-realtime-mini for voice I/O only
 * - Does NOT execute tools or make decisions
 * - Receives events from backend agents and narrates them
 * - Provides immediate voice acknowledgments
 * - Streams voice responses asynchronously
 */
export function createVoiceNarrationAgent(config: VoiceNarrationConfig = {}): RealtimeAgent {
  const agent = new RealtimeAgent({
    name: 'VoiceNarrator',
    voice: config.voice || 'alloy',
    instructions: () => {
      return [
        'You are a voice narrator for an email assistant.',
        '',
        '=== YOUR ONLY JOB ===',
        '1. Acknowledge user requests briefly (e.g., "Let me check that for you")',
        '2. Narrate backend agent progress as events arrive',
        '3. Deliver final summaries when backend completes',
        '',
        '=== CRITICAL RULES ===',
        '- DO NOT attempt to answer questions yourself',
        '- DO NOT repeat or echo user utterances',
        '- DO NOT execute tools or make decisions',
        '- DO NOT provide information until backend sends results',
        '',
        '=== NARRATION EXAMPLES ===',
        '- "I\'m routing your request to the Email Operations Agent..."',
        '- "The agent is calling the triage_recent_emails tool..."',
        '- "Processing complete. I found 5 urgent emails..."',
        '',
        '=== WAIT FOR BACKEND ===',
        'You are a narrator, not a processor. The backend agents do all the work.',
        'Only speak when you receive explicit narration events or final results.',
      ].join('\n');
    },
    tools: [], // No tools - this agent only narrates
  });

  return agent;
}

// ============================================================================
// Voice Narration Session Manager
// ============================================================================

export class VoiceNarrationSession {
  private session: RealtimeSession | null = null;
  private agent: RealtimeAgent;
  private config: VoiceNarrationConfig;
  private eventQueue: BackendAgentEvent[] = [];
  private isNarrating = false;
  private narrationPaused = false;

  constructor(config: VoiceNarrationConfig = {}) {
    this.config = config;
    this.agent = createVoiceNarrationAgent(config);
  }

  /**
   * Inject a mock session for testing (bypasses connect())
   */
  setSession(session: RealtimeSession | null): void {
    this.session = session;
  }

  /**
   * Connect to the OpenAI Realtime API
   */
  async connect(apiKey: string): Promise<void> {
    this.session = new RealtimeSession(this.agent, {
      model: VOICE_MODEL,
      config: {
        inputAudioTranscription: { model: 'gpt-4o-mini-transcribe' },
      },
    });

    // Set up event listeners
    this.session.on?.('history_updated', (history: unknown[]) => {
      try {
        console.debug('[voiceNarration] history_updated', history);
        this.config.onTranscript?.(history);
      } catch (error) {
        console.warn('[voiceNarration] Transcript handler error:', error);
      }
    });

    const sessionAny = this.session as any;
    if (sessionAny.addEventListener) {
      sessionAny.addEventListener('response.audio.delta', (event: any) => {
        try {
          console.debug('[voiceNarration] response.audio.delta - agent audio streaming');
          this.config.onAudioDelta?.(event?.delta);
        } catch (error) {
          console.warn('[voiceNarration] Audio delta handler error:', error);
        }
      });

      sessionAny.addEventListener('response.done', (event: any) => {
        try {
          console.debug('[voiceNarration] response.done', event);
          this.isNarrating = false;
          this.processNextEvent();
        } catch (error) {
          console.warn('[voiceNarration] Response done handler error:', error);
        }
      });
    }

    // Connect to OpenAI Realtime API
    await this.session.connect({ apiKey, model: VOICE_MODEL });
    console.log('[voiceNarration] Connected to OpenAI Realtime API');
  }

  /**
   * Disconnect from the OpenAI Realtime API
   */
  async disconnect(): Promise<void> {
    if (this.session) {
      const s: any = this.session as any;
      try {
        if (typeof s.disconnect === 'function') {
          await s.disconnect();
        } else if (typeof s.close === 'function') {
          await s.close();
        } else if (s.transport && typeof s.transport.disconnect === 'function') {
          await s.transport.disconnect();
        } else if (s.transport && typeof s.transport.close === 'function') {
          await s.transport.close();
        }
      } catch (err) {
        console.warn('[voiceNarration] disconnect fallback error:', err);
      }
      this.session = null;
      console.log('[voiceNarration] Disconnected from OpenAI Realtime API');
    }
  }

  /**
   * Provide immediate voice acknowledgment for user request
   */
  async acknowledgeRequest(userInput: string): Promise<void> {
    if (!this.session) {
      console.warn('[voiceNarration] Session not connected');
      return;
    }

    // Send immediate acknowledgment
    const acknowledgment = this.generateAcknowledgment(userInput);
    await this.narrate(acknowledgment);
  }

  /**
   * Receive a backend event and narrate it
   */
  async receiveBackendEvent(event: BackendAgentEvent): Promise<void> {
    console.debug('[voiceNarration] Received backend event:', event.type);

    // Add to queue
    this.eventQueue.push(event);

    // If paused, do not process now
    if (this.narrationPaused) return;

    // Process queue if not currently narrating
    if (!this.isNarrating) {
      await this.processNextEvent();
    }
  }

  /**
   * Process the next event in the queue
   */
  private async processNextEvent(): Promise<void> {
    if (this.eventQueue.length === 0 || this.isNarrating) {
      return;
    }

    const event = this.eventQueue.shift();
    if (!event) return;

    // Format event for voice narration
    const narration = formatEventForVoiceNarration(event);
    if (narration) {
      await this.narrate(narration);
    } else {
      // No narration needed, process next event
      await this.processNextEvent();
    }
  }

  /**
   * Narrate a message using the voice agent
   */
  private async narrate(message: string): Promise<void> {
    if (!this.session) {
      console.warn('[voiceNarration] Session not connected');
      return;
    }

    this.isNarrating = true;
    console.debug('[voiceNarration] Narrating:', message);

    try {
      // Send message to the voice agent for narration
      // The agent will convert it to speech and stream it to the user
      const sessionAny = this.session as any;
      if (sessionAny.sendMessage) {
        await sessionAny.sendMessage(message);
      } else if (sessionAny.send) {
        await sessionAny.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: message }] } });
      } else {
        console.warn('[voiceNarration] No send method available on session');
        this.isNarrating = false;
      }
    } catch (error) {
      console.error('[voiceNarration] Narration error:', error);
      this.isNarrating = false;
      await this.processNextEvent();
    }
  }

  /**
   * Generate an immediate acknowledgment for user request
   */
  private generateAcknowledgment(userInput: string): string {
    const lowerInput = userInput.toLowerCase();

    if (lowerInput.includes('email') || lowerInput.includes('message')) {
      return "Let me check your emails for you.";
    } else if (lowerInput.includes('calendar') || lowerInput.includes('event') || lowerInput.includes('meeting')) {
      return "I'll look up your calendar for you.";
    } else if (lowerInput.includes('contact')) {
      return "Let me search your contacts.";
    } else if (lowerInput.includes('insight') || lowerInput.includes('analytic') || lowerInput.includes('trend')) {
      return "I'll analyze that for you.";
    } else {
      return "Let me help you with that.";
    }
  }

  /**
   * Provide final voice summary based on backend results
   */
  async provideFinalSummary(result: any): Promise<void> {
    if (!this.session) {
      console.warn('[voiceNarration] Session not connected');
      return;
    }

    // Extract final output from backend result
    const finalOutput = result?.finalOutput || result?.output || 'Processing complete.';
    // Narrate the final summary
    await this.narrate(finalOutput);
  }

  /**
   * Pause/Resume narration processing
   */
  pauseNarration(): void {
    this.narrationPaused = true;
  }

  async resumeNarration(): Promise<void> {
    this.narrationPaused = false;
    if (!this.isNarrating) {
      await this.processNextEvent();
    }
  }

  /**
   * Get the current session
   */
  getSession(): RealtimeSession | null {
    return this.session;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.session !== null;
  }
}

// ============================================================================
// Voice Narration Utilities
// ============================================================================

/**
 * Create a voice narration session with automatic event handling
 */
export async function createVoiceNarrationSession(
  apiKey: string,
  config: VoiceNarrationConfig = {}
): Promise<VoiceNarrationSession> {
  const session = new VoiceNarrationSession(config);
  await session.connect(apiKey);
  return session;
}

