import { RealtimeAgent } from '@openai/agents/realtime';
import type { Tool } from '@openai/agents-core';
import { attachAgentLifecycle } from './graphHooks';
import type { SpecialistEnvironment } from './runtime';

export function createEmailOpsAgent(env: SpecialistEnvironment, tools: Tool[]): RealtimeAgent {
  const agent = new RealtimeAgent({
    name: 'EmailOpsAgent',
    instructions: () => {
      return [
        'You handle email triage tasks: unread listing, focused searches, counting messages, and applying metadata filters.',
        'Always ground responses in the actual tool outputs you receive.',
        'If results are empty, suggest alternative filters rather than fabricating content.',
        'Recent context:',
        env.scratchpad.toInstructionSummary(),
      ].join('\n');
    },
    tools,
  });

  agent.on('agent_start', () => env.progress('[EmailOpsAgent] Starting email triage.'));
  agent.on('agent_end', () => env.progress('[EmailOpsAgent] Completed email task.'));

  attachAgentLifecycle(agent, env.id, env.callGraph);
  return agent;
}
