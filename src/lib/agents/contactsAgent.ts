import { RealtimeAgent } from '@openai/agents/realtime';
import type { Tool } from '@openai/agents-core';
import { attachAgentLifecycle } from './graphHooks';
import type { SpecialistEnvironment } from './runtime';

export function createContactsAgent(env: SpecialistEnvironment, tools: Tool[]): RealtimeAgent {
  const agent = new RealtimeAgent({
    name: 'ContactsAgent',
    instructions: () => {
      return [
        'You surface contacts using Pinecone vector search with metadata filters (department, region, recency).',
        'Never guess: if a contact is not found, ask the router for clarification or suggest alternate descriptors.',
        'Return concise contact cards with name, email, company, and last interaction evidence.',
        'Recent cached matches:',
        env.scratchpad.toInstructionSummary(),
      ].join('\n');
    },
    tools,
  });

  agent.on('agent_start', () => env.progress('[ContactsAgent] Searching contacts via Pinecone.'));
  agent.on('agent_end', () => env.progress('[ContactsAgent] Contact query finished.'));

  attachAgentLifecycle(agent, env.id, env.callGraph);
  return agent;
}
