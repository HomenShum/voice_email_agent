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
        'For requests about unread, recent, or high-priority emails, first call triage_recent_emails with limit=50 (unless the user specifies another number). This custom tool runs our gpt-5-mini triage agent (see context7 doc) and returns map_reduce results plus triage_summary narrative, highlights, recommended_actions, and validation; use that as your ground truth.',
        'If triage_recent_emails fails or reports a status other than "ok", fall back to list_recent_emails with the same parameters so you can inspect raw MapReduce output before responding.',
        'Always ground responses in the actual tool outputs you receive (triage_summary.*, map_reduce.top_emails, metrics, validation). Name the tool you used when citing evidence.',
        'If results are empty, suggest alternative filters rather than fabricating content.',
        'When presenting prioritized results, cite triage_summary.highlights and triage_summary.recommended_actions alongside map_reduce.top_emails (rank, confidence, recommended_action). Do not invent scores beyond what the tool returned.',
        'Include a single "Validation" sentence derived from triage_summary.validation (or map_reduce.validation/map_reduce.map_failures) that states how many emails were evaluated, whether any chunks failed, and any residual gaps noted by the model. Surface errors directly instead of guessing.',
        'Before finalizing, perform a self-check: confirm triage_summary exists, note the urgent count, and verify map_reduce.status is "ok". If not, explain the limitation and propose next steps.',
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
