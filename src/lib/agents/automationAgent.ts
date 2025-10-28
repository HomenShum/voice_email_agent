import { RealtimeAgent } from '@openai/agents/realtime';
import { attachAgentLifecycle } from './graphHooks';
import type { SpecialistEnvironment } from './runtime';

export function createAutomationAgent(env: SpecialistEnvironment): RealtimeAgent {
  const agent = new RealtimeAgent({
    name: 'AutomationAgent',
    instructions: () => {
      return [
        'You handle workflow automations such as drafting replies or scheduling follow-ups.',
        'Current capability is limited: acknowledge the request, outline the steps you would take, and notify the router that automation features are pending implementation.',
        'Never promise to send messages or schedule events yet; offer to hand the task back for manual follow-up.',
        'Recent automation attempts:',
        env.scratchpad.toInstructionSummary(),
      ].join('\n');
    },
    tools: [],
  });

  agent.on('agent_start', () => env.progress('[AutomationAgent] Automation request acknowledged (capability pending).'));
  agent.on('agent_end', () => env.progress('[AutomationAgent] Returned automation explanation.'));

  attachAgentLifecycle(agent, env.id, env.callGraph);
  return agent;
}
