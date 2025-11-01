/**
 * Backend Processing Layer - Standard Agent with gpt-5-mini
 * 
 * This module implements the backend processing logic using standard Agent (not RealtimeAgent).
 * All actual data processing, tool execution, and decision-making happens here.
 * 
 * The backend agents emit lifecycle events that are streamed to:
 * 1. Voice narration layer (for real-time voice feedback)
 * 2. UI dashboard (for visual progress tracking)
 */

import { Agent } from '@openai/agents';
import type { Tool } from '@openai/agents-core';
import { attachAgentLifecycle } from './graphHooks';
import type { CallGraph } from './callGraph';
import type { Scratchpad } from './scratchpad';

// ============================================================================
// Backend Agent Configuration
// ============================================================================

const BACKEND_MODEL = 'gpt-5-mini'; // Standard Chat Completions model for backend processing

export const SPECIALIST_IDS = [
  'email_ops',
  'insights',
  'contacts',
  'calendar',
  'automation',
] as const;

export const DISPLAY_NAMES: Record<(typeof SPECIALIST_IDS)[number], string> = {
  email_ops: 'EmailOpsAgent',
  insights: 'InsightAgent',
  contacts: 'ContactsAgent',
  calendar: 'CalendarAgent',
  automation: 'AutomationAgent',
};

export const SPECIALIST_CAPABILITIES: Record<(typeof SPECIALIST_IDS)[number], string> = {
  email_ops: 'Email triage, unread listings, focused searches, message counts, and metadata filtering',
  insights: 'Email analytics, aggregations, trend analysis, and semantic search across your inbox',
  contacts: 'Contact lookups, relationship mapping, and communication history analysis',
  calendar: 'Calendar availability, event lookups, scheduling analysis, and time management',
  automation: 'Workflow automation, rule creation, and task scheduling (capability pending)',
};

// ============================================================================
// Event Streaming Types
// ============================================================================

export type BackendAgentEvent =
  | { type: 'agent_started'; agentId: string; agentName: string; timestamp: number }
  | { type: 'agent_completed'; agentId: string; agentName: string; timestamp: number; output: any }
  | { type: 'agent_handoff'; fromAgent: string; toAgent: string; timestamp: number }
  | { type: 'tool_started'; agentId: string; toolName: string; parameters: any; timestamp: number }
  | { type: 'tool_completed'; agentId: string; toolName: string; result: any; timestamp: number }
  | { type: 'progress_update'; agentId: string; message: string; timestamp: number };

export type BackendEventHandler = (event: BackendAgentEvent) => void;

// ============================================================================
// Backend Agent Environment
// ============================================================================

export interface BackendSpecialistEnvironment {
  id: (typeof SPECIALIST_IDS)[number];
  name: string;
  scratchpad: Scratchpad;
  callGraph: CallGraph;
  progress: (message: string) => void;
  emitEvent: BackendEventHandler;
}

export interface BackendRouterEnvironment {
  id: 'router';
  name: string;
  callGraph: CallGraph;
  scratchpads: Record<string, Scratchpad>;
  progress: (message: string) => void;
  emitEvent: BackendEventHandler;
}

// ============================================================================
// Backend Specialist Agents (Standard Agent with gpt-5-mini)
// ============================================================================

export function createBackendEmailOpsAgent(env: BackendSpecialistEnvironment, tools: Tool[]): Agent {
  const agent = new Agent({
    name: 'EmailOpsAgent',
    model: BACKEND_MODEL,
    instructions: () => {
      return [
        'You handle email triage tasks: unread listing, focused searches, counting messages, and applying metadata filters.',
        'For requests about unread, recent, or high-priority emails, first call triage_recent_emails with limit=50 (unless the user specifies another number).',
        'Always ground responses in the actual tool outputs you receive. Name the tool you used when citing evidence.',
        'If results are empty, suggest alternative filters rather than fabricating content.',
        'Recent context:',
        env.scratchpad.toInstructionSummary(),
      ].join('\n');
    },
    tools,
  });

  // Attach lifecycle hooks for event emission
  agent.on('agent_start', () => {
    env.progress('[EmailOpsAgent] Starting email triage.');
    env.emitEvent({
      type: 'agent_started',
      agentId: env.id,
      agentName: env.name,
      timestamp: Date.now(),
    });
  });

  agent.on('agent_end', (_context: any, output: any) => {
    env.progress('[EmailOpsAgent] Completed email task.');
    env.emitEvent({
      type: 'agent_completed',
      agentId: env.id,
      agentName: env.name,
      timestamp: Date.now(),
      output,
    });
  });

  agent.on('agent_tool_start', (_context: any, tool: any, details: any) => {
    const parameters = details?.toolCall?.input || {};
    env.progress(`[EmailOpsAgent] Calling tool: ${tool.name}`);
    env.emitEvent({
      type: 'tool_started',
      agentId: env.id,
      toolName: tool.name,
      parameters,
      timestamp: Date.now(),
    });
  });

  agent.on('agent_tool_end', (_context: any, tool: any, result: any) => {
    env.progress(`[EmailOpsAgent] Tool ${tool.name} completed.`);
    env.emitEvent({
      type: 'tool_completed',
      agentId: env.id,
      toolName: tool.name,
      result,
      timestamp: Date.now(),
    });
  });

  attachAgentLifecycle(agent, env.id, env.callGraph);
  return agent;
}

export function createBackendInsightAgent(env: BackendSpecialistEnvironment, tools: Tool[]): Agent {
  const agent = new Agent({
    name: 'InsightAgent',
    model: BACKEND_MODEL,
    instructions: () => {
      return [
        'You provide email analytics, aggregations, and trend analysis.',
        'Use semantic search and aggregation tools to surface patterns and insights.',
        'Always cite the specific tools and data sources you used.',
        'Recent context:',
        env.scratchpad.toInstructionSummary(),
      ].join('\n');
    },
    tools,
  });

  agent.on('agent_start', () => {
    env.progress('[InsightAgent] Computing analytics.');
    env.emitEvent({ type: 'agent_started', agentId: env.id, agentName: env.name, timestamp: Date.now() });
  });

  agent.on('agent_end', (_context: any, output: any) => {
    env.progress('[InsightAgent] Analytics complete.');
    env.emitEvent({ type: 'agent_completed', agentId: env.id, agentName: env.name, timestamp: Date.now(), output });
  });

  agent.on('agent_tool_start', (_context: any, tool: any, details: any) => {
    env.emitEvent({ type: 'tool_started', agentId: env.id, toolName: tool.name, parameters: details?.toolCall?.input || {}, timestamp: Date.now() });
  });

  agent.on('agent_tool_end', (_context: any, tool: any, result: any) => {
    env.emitEvent({ type: 'tool_completed', agentId: env.id, toolName: tool.name, result, timestamp: Date.now() });
  });

  attachAgentLifecycle(agent, env.id, env.callGraph);
  return agent;
}

export function createBackendContactsAgent(env: BackendSpecialistEnvironment, tools: Tool[]): Agent {
  const agent = new Agent({
    name: 'ContactsAgent',
    model: BACKEND_MODEL,
    instructions: () => {
      return [
        'You handle contact lookups and relationship mapping.',
        'Use Pinecone semantic search to find relevant contacts.',
        'Recent context:',
        env.scratchpad.toInstructionSummary(),
      ].join('\n');
    },
    tools,
  });

  agent.on('agent_start', () => {
    env.progress('[ContactsAgent] Searching contacts via Pinecone.');
    env.emitEvent({ type: 'agent_started', agentId: env.id, agentName: env.name, timestamp: Date.now() });
  });

  agent.on('agent_end', (_context: any, output: any) => {
    env.progress('[ContactsAgent] Contact query finished.');
    env.emitEvent({ type: 'agent_completed', agentId: env.id, agentName: env.name, timestamp: Date.now(), output });
  });

  agent.on('agent_tool_start', (_context: any, tool: any, details: any) => {
    env.emitEvent({ type: 'tool_started', agentId: env.id, toolName: tool.name, parameters: details?.toolCall?.input || {}, timestamp: Date.now() });
  });

  agent.on('agent_tool_end', (_context: any, tool: any, result: any) => {
    env.emitEvent({ type: 'tool_completed', agentId: env.id, toolName: tool.name, result, timestamp: Date.now() });
  });

  attachAgentLifecycle(agent, env.id, env.callGraph);
  return agent;
}

export function createBackendCalendarAgent(env: BackendSpecialistEnvironment, tools: Tool[]): Agent {
  const agent = new Agent({
    name: 'CalendarAgent',
    model: BACKEND_MODEL,
    instructions: () => {
      return [
        'You answer calendar availability questions using structured event lookups.',
        'Respect explicit date/time windows and call out which filters were applied.',
        'Recent context:',
        env.scratchpad.toInstructionSummary(),
      ].join('\n');
    },
    tools,
  });

  agent.on('agent_start', () => {
    env.progress('[CalendarAgent] Fetching calendar data.');
    env.emitEvent({ type: 'agent_started', agentId: env.id, agentName: env.name, timestamp: Date.now() });
  });

  agent.on('agent_end', (_context: any, output: any) => {
    env.progress('[CalendarAgent] Calendar query complete.');
    env.emitEvent({ type: 'agent_completed', agentId: env.id, agentName: env.name, timestamp: Date.now(), output });
  });

  agent.on('agent_tool_start', (_context: any, tool: any, details: any) => {
    env.emitEvent({ type: 'tool_started', agentId: env.id, toolName: tool.name, parameters: details?.toolCall?.input || {}, timestamp: Date.now() });
  });

  agent.on('agent_tool_end', (_context: any, tool: any, result: any) => {
    env.emitEvent({ type: 'tool_completed', agentId: env.id, toolName: tool.name, result, timestamp: Date.now() });
  });

  attachAgentLifecycle(agent, env.id, env.callGraph);
  return agent;
}

export function createBackendAutomationAgent(env: BackendSpecialistEnvironment): Agent {
  const agent = new Agent({
    name: 'AutomationAgent',
    model: BACKEND_MODEL,
    instructions: () => {
      return [
        'You handle workflow automation requests.',
        'Currently, automation capabilities are pending implementation.',
        'Explain what automation would be possible and suggest manual alternatives.',
        'Recent context:',
        env.scratchpad.toInstructionSummary(),
      ].join('\n');
    },
    tools: [],
  });

  agent.on('agent_start', () => {
    env.progress('[AutomationAgent] Automation request acknowledged.');
    env.emitEvent({ type: 'agent_started', agentId: env.id, agentName: env.name, timestamp: Date.now() });
  });

  agent.on('agent_end', (_context: any, output: any) => {
    env.progress('[AutomationAgent] Returned automation explanation.');
    env.emitEvent({ type: 'agent_completed', agentId: env.id, agentName: env.name, timestamp: Date.now(), output });
  });

  attachAgentLifecycle(agent, env.id, env.callGraph);
  return agent;
}

// ============================================================================
// Backend Router Agent (Standard Agent with gpt-5-mini)
// ============================================================================

export function createBackendRouterAgent(
  env: BackendRouterEnvironment,
  specialists: Record<(typeof SPECIALIST_IDS)[number], Agent>
): Agent {
  const agent = new Agent({
    name: 'RouterAgent',
    model: BACKEND_MODEL,
    instructions: () => {
      const capabilityLines = SPECIALIST_IDS
        .map((id) => `- ${DISPLAY_NAMES[id]}: ${SPECIALIST_CAPABILITIES[id]}`)
        .join('\n');

      return [
        'You are the RouterAgent orchestrating this email assistant conversation.',
        '',
        '=== WORKFLOW: PLAN → DELEGATE → SYNTHESIZE ===',
        '',
        '1. PLAN (Think First)',
        '   - Analyze the user\'s request carefully',
        '   - Identify which specialist(s) can help',
        '   - Determine what information is needed',
        '   - Narrate your plan: "I\'m going to route this to [Specialist] to [action]..."',
        '',
        '2. DELEGATE (Route to Specialist)',
        '   - Hand off to the appropriate specialist using handoffs',
        '   - Let the specialist execute tools and gather data',
        '   - Wait for the specialist to complete',
        '',
        '3. SYNTHESIZE (Summarize Results)',
        '   - Present a concise, natural summary of what was found',
        '   - Cite actual tool outputs and data points',
        '   - Answer the user\'s original question directly',
        '',
        '=== AVAILABLE SPECIALISTS ===',
        capabilityLines,
        '',
        '=== CRITICAL RULES ===',
        '- ALWAYS narrate your planning step before delegating',
        '- DO NOT jump straight to tool execution without explaining your plan',
        '- DO NOT provide vague summaries; cite specific data from tool results',
        '- DO NOT delegate to multiple specialists unless truly necessary',
        '',
        '=== EXAMPLE FLOW ===',
        'User: "Tell me about my recent emails"',
        'You: "I\'m going to route this to the Email Operations Agent to retrieve and analyze your recent messages..."',
        '[Delegate to EmailOpsAgent]',
        '[EmailOpsAgent executes triage_recent_emails tool]',
        'You: "I found 13 recent emails. 3 are urgent: one interview request from TechCorp, one deadline reminder for the Q4 report, and one meeting reschedule from your manager."',
      ].join('\n');
    },
    handoffs: Object.values(specialists),
  });

  agent.on('agent_start', () => {
    env.progress('[RouterAgent] Starting request processing.');
    env.emitEvent({ type: 'agent_started', agentId: 'router', agentName: 'RouterAgent', timestamp: Date.now() });
  });

  agent.on('agent_end', (_context: any, output: any) => {
    env.progress('[RouterAgent] Request processing complete.');
    env.emitEvent({ type: 'agent_completed', agentId: 'router', agentName: 'RouterAgent', timestamp: Date.now(), output });
  });

  agent.on('agent_handoff', (_context: any, nextAgent: any) => {
    const toAgentName = nextAgent?.name || 'Unknown';
    env.progress(`[RouterAgent] Delegating to ${toAgentName}.`);
    env.emitEvent({ type: 'agent_handoff', fromAgent: 'RouterAgent', toAgent: toAgentName, timestamp: Date.now() });
  });

  return agent;
}

