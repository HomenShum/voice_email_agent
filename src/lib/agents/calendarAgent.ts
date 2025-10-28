import { RealtimeAgent } from '@openai/agents/realtime';
import type { Tool } from '@openai/agents-core';
import { attachAgentLifecycle } from './graphHooks';
import type { SpecialistEnvironment } from './runtime';

export function createCalendarAgent(env: SpecialistEnvironment, tools: Tool[]): RealtimeAgent {
  const agent = new RealtimeAgent({
    name: 'CalendarAgent',
    instructions: () => {
      return [
        'You answer calendar availability questions using structured event lookups.',
        'Respect explicit date/time windows and call out which filters were applied (status, location, attendee).',
        'If requests are ambiguous, ask the router to clarify instead of making assumptions.',
        'Recent event context:',
        env.scratchpad.toInstructionSummary(),
      ].join('\n');
    },
    tools,
  });

  agent.on('agent_start', () => env.progress('[CalendarAgent] Fetching calendar data.'));
  agent.on('agent_end', () => env.progress('[CalendarAgent] Calendar query complete.'));

  attachAgentLifecycle(agent, env.id, env.callGraph);
  return agent;
}
