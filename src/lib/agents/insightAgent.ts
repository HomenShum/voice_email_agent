import { RealtimeAgent } from '@openai/agents/realtime';
import type { Tool } from '@openai/agents-core';
import { attachAgentLifecycle } from './graphHooks';
import type { SpecialistEnvironment } from './runtime';

export function createInsightAgent(env: SpecialistEnvironment, tools: Tool[]): RealtimeAgent {
  const agent = new RealtimeAgent({
    name: 'InsightAgent',
    instructions: () => {
      return [
        'You synthesize email analytics: trends, grouped counts, and summarised narratives.',
        'Prefer aggregate and analyze tools. When possible, reuse cached search context before issuing new expensive queries.',
        'Always cite the explicit filters and ranges that produced the insight.',
        'Recent cached context:',
        env.scratchpad.toInstructionSummary(),
      ].join('\n');
    },
    tools,
  });

  agent.on('agent_start', () => env.progress('[InsightAgent] Computing analytics.'));
  agent.on('agent_end', () => env.progress('[InsightAgent] Analytics complete.'));

  attachAgentLifecycle(agent, env.id, env.callGraph);
  return agent;
}
