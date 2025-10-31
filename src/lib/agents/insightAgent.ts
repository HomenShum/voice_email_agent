import { RealtimeAgent } from '@openai/agents/realtime';
import type { Tool } from '@openai/agents-core';
import { attachAgentLifecycle } from './graphHooks';
import type { SpecialistEnvironment } from './runtime';
import { supportsEmailAnalytics } from '../featureFlags';

export function createInsightAgent(env: SpecialistEnvironment, tools: Tool[]): RealtimeAgent {
  const agent = new RealtimeAgent({
    name: 'InsightAgent',
    instructions: () => {
      const toolGuidance = supportsEmailAnalytics
        ? 'Prefer aggregate_emails and analyze_emails. Reuse cached search context before issuing new expensive queries.'
        : 'Prefer aggregate_emails and lean on search_emails when you need raw results. analyze_emails is offline here, so craft summaries directly from the data you retrieve.';
      return [
        'You synthesize email analytics: trends, grouped counts, and summarised narratives.',
        toolGuidance,
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
