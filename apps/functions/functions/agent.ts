import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { app } from '@azure/functions';
import { Agent, run } from '@openai/agents';
import { createAgentTools } from '../shared/agentTools.js';

// NOTE: This is a simplified server-side agent implementation
// The full hybrid architecture (with CallGraph, Scratchpad, multi-agent routing) runs in the browser
// This endpoint provides a minimal backend agent for server-side execution with Key Vault secrets

const BACKEND_MODEL = 'gpt-5-mini';

type BackendAgentEvent = {
  type: string;
  agentId?: string;
  agentName?: string;
  toolName?: string;
  parameters?: any;
  result?: any;
  output?: any;
  timestamp: number;
  fromAgent?: string;
  toAgent?: string;
};

type BackendEventHandler = (event: BackendAgentEvent) => void;

// Helper to add CORS headers
function withCors(response: HttpResponseInit): HttpResponseInit {
  return {
    ...response,
    headers: {
      ...response.headers,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
  };
}

// Simplified server-side agent (no complex dependencies)
function createServerBackendAgent(grantId: string, onEvent?: BackendEventHandler): Agent {
  const emitEvent = onEvent || (() => {});

  // Create tools for this grantId
  const toolsets = createAgentTools(grantId, emitEvent);
  const allTools = [
    ...toolsets.email,
    ...toolsets.insights,
    ...toolsets.contacts,
    ...toolsets.calendar,
  ];

  const agent = new Agent({
    name: 'ServerBackendAgent',
    model: BACKEND_MODEL,
    instructions: () => {
      return [
        'You are a server-side email assistant backend agent.',
        '',
        '=== WORKFLOW: PLAN → EXECUTE → SYNTHESIZE ===',
        '',
        '1. PLAN (Think First)',
        '   - Analyze the user\'s request carefully',
        '   - Determine what tools are needed',
        '   - Narrate your plan: "I\'m going to use [tool] to [action]..."',
        '',
        '2. EXECUTE (Use Tools)',
        '   - Call the appropriate tools with correct parameters',
        '   - Gather all necessary data',
        '',
        '3. SYNTHESIZE (Summarize Results)',
        '   - Present a concise, natural summary of what was found',
        '   - Cite actual tool outputs and data points',
        '   - Answer the user\'s original question directly',
        '',
        '=== AVAILABLE TOOLS ===',
        '- search_emails: Search emails using hybrid vector + sparse search',
        '- triage_recent_emails: Triage recent emails to identify urgent/important messages',
        '- list_unread_messages: List unread messages from Nylas',
        '- aggregate_emails: Aggregate email counts by metadata fields',
        '- list_contacts: List contacts from Nylas',
        '- list_events: List calendar events from Nylas',
        '',
        '=== CRITICAL RULES ===',
        '- ALWAYS narrate your planning step before using tools',
        '- DO NOT jump straight to tool execution without explaining your plan',
        '- DO NOT provide vague summaries; cite specific data from tool results',
        '',
        '=== EXAMPLE FLOW ===',
        'User: "Tell me about my recent emails"',
        'You: "I\'m going to use the triage_recent_emails tool to retrieve and analyze your recent messages..."',
        '[Execute triage_recent_emails tool]',
        'You: "I found 13 recent emails. 3 are urgent: one interview request from TechCorp, one deadline reminder for the Q4 report, and one meeting reschedule from your manager."',
      ].join('\n');
    },
    tools: allTools,
  });

  agent.on('agent_start', () => {
    emitEvent({ type: 'agent_started', agentId: 'server', agentName: 'ServerBackendAgent', timestamp: Date.now() });
  });

  agent.on('agent_end', (_context: any, output: any) => {
    emitEvent({ type: 'agent_completed', agentId: 'server', agentName: 'ServerBackendAgent', timestamp: Date.now(), output });
  });

  // Note: tool_call and tool_result events are not available in the current @openai/agents version
  // Tool execution events will be captured through agent_end output

  return agent;
}

/**
 * Azure Functions HTTP endpoint for server-side backend agent execution
 *
 * POST /api/agent
 * Body: { userInput: string, grantId: string }
 *
 * Returns: Server-Sent Events (SSE) stream with:
 * - Real-time agent events (agent_started, tool_call_started, tool_call_completed, agent_completed)
 * - Final result event with agent output
 */
export async function agentHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('[agent] Received request');

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return withCors({ status: 200 });
  }

  try {
    const body = await request.json() as { userInput: string; grantId: string };
    const { userInput, grantId } = body;

    if (!userInput) {
      return withCors({
        status: 400,
        jsonBody: { error: 'Missing userInput in request body' },
      });
    }

    context.log(`[agent] Processing request for grant ${grantId}: ${userInput}`);

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Create server-side agent with event streaming
          const agent = createServerBackendAgent(grantId, (event: BackendAgentEvent) => {
            const data = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(data));
          });

          // Run agent with streaming
          context.log('[agent] Starting agent execution');
          const streamResult = await run(agent, userInput, { stream: true });

          // Stream events to client as SSE frames
          for await (const event of streamResult) {
            try {
              const payload = { type: 'openai_event', event };
              const data = `data: ${JSON.stringify(payload)}\n\n`;
              controller.enqueue(encoder.encode(data));
            } catch (e) {
              // swallow
            }
            context.log(`[agent] Stream event: ${event.type}`);
          }

          // Wait for completion
          await streamResult.completed;

          // Extract final output
          const finalOutput = streamResult.finalOutput;
          let finalText: string;
          if (typeof finalOutput === 'string') {
            finalText = finalOutput;
          } else if (Array.isArray(finalOutput)) {
            finalText = (finalOutput as any[]).map((o: any) => (typeof o === 'string' ? o : JSON.stringify(o))).join('\n');
          } else {
            finalText = JSON.stringify(finalOutput);
          }

          const result = { finalOutput: finalText };

          // Send final result event
          const finalData = `data: ${JSON.stringify({ type: 'final', result })}\n\n`;
          controller.enqueue(encoder.encode(finalData));

          context.log('[agent] Agent execution complete');
          controller.close();
        } catch (error) {
          context.error('[agent] Error during execution:', error);
          const errorData = `data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`;
          controller.enqueue(encoder.encode(errorData));
          controller.close();
        }
      },
    });

    return withCors({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
      body: stream as any, // Azure Functions v4 typing issue with ReadableStream
    });
  } catch (error) {
    context.error('[agent] Request handling error:', error);
    return withCors({
      status: 500,
      jsonBody: { error: String(error) },
    });
  }
}

app.http('agent', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: agentHandler,
});

