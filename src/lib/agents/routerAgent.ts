import { RealtimeAgent } from '@openai/agents/realtime';
import { handoff } from '@openai/agents-core';
import type { Tool } from '@openai/agents-core';
import { attachAgentLifecycle, tagAgent } from './graphHooks';
import {
  AUTOMATION_AGENT_ID,
  CALENDAR_AGENT_ID,
  CONTACTS_AGENT_ID,
  EMAIL_AGENT_ID,
  INSIGHT_AGENT_ID,
  ROUTER_AGENT_ID,
  SPECIALIST_IDS,
  createRouterRuntime,
} from './runtime';
import type { SpecialistId } from './runtime';
import { createEmailOpsAgent } from './emailOpsAgent';
import { createInsightAgent } from './insightAgent';
import { createContactsAgent } from './contactsAgent';
import { createCalendarAgent } from './calendarAgent';
import { createAutomationAgent } from './automationAgent';

const DISPLAY_NAMES: Record<(typeof SPECIALIST_IDS)[number], string> = {
  [EMAIL_AGENT_ID]: 'EmailOpsAgent',
  [INSIGHT_AGENT_ID]: 'InsightAgent',
  [CONTACTS_AGENT_ID]: 'ContactsAgent',
  [CALENDAR_AGENT_ID]: 'CalendarAgent',
  [AUTOMATION_AGENT_ID]: 'AutomationAgent',
};

export type IntentDecision =
  | { agentId: SpecialistId; confident: true; rationale: string }
  | { agentId: null; confident: false; rationale: string };

export interface RouterDependencies {
  tools: {
    email: Tool[];
    insights: Tool[];
    contacts: Tool[];
    calendar: Tool[];
    sync?: Tool[];
  };
  onProgress?: (message: string) => void;
}

export interface RouterBundle {
  router: RealtimeAgent;
  specialists: Record<(typeof SPECIALIST_IDS)[number], RealtimeAgent>;
  runtime: ReturnType<typeof createRouterRuntime>;
}

export function determineIntent(userText: string): IntentDecision {
  const text = userText.trim().toLowerCase();
  if (!text) {
    return { agentId: null, confident: false, rationale: 'No user utterance captured yet.' };
  }

  const emailPatterns = /(unread|inbox|latest emails?|search my emails?|find (an|the) email|from:|subject:)/i;
  if (emailPatterns.test(text)) {
    return { agentId: EMAIL_AGENT_ID, confident: true, rationale: 'Matched email triage keywords.' };
  }

  const insightPatterns = /(summary|summarize|trend|insight|breakdown|stats?|metrics?|aggregate)/i;
  if (insightPatterns.test(text)) {
    return { agentId: INSIGHT_AGENT_ID, confident: true, rationale: 'Matched analytics/summary keywords.' };
  }

  const contactsPatterns = /(contact|who is|phone|email address|reach out|introduce)/i;
  if (contactsPatterns.test(text)) {
    return { agentId: CONTACTS_AGENT_ID, confident: true, rationale: 'Matched contact lookup keywords.' };
  }

  const calendarPatterns = /(calendar|availability|meeting|schedule|next week|free on)/i;
  if (calendarPatterns.test(text)) {
    return { agentId: CALENDAR_AGENT_ID, confident: true, rationale: 'Matched calendar-related keywords.' };
  }

  const automationPatterns = /(draft|reply for me|follow[- ]?up|auto(?:mate|mation)|send an email|schedule a task)/i;
  if (automationPatterns.test(text)) {
    return { agentId: AUTOMATION_AGENT_ID, confident: true, rationale: 'Matched automation keywords.' };
  }

  return { agentId: null, confident: false, rationale: 'No routing rule matched current utterance.' };
}

export function createRouterBundle(deps: RouterDependencies): RouterBundle {
  const runtime = createRouterRuntime(deps.onProgress);
  const specialists: Record<(typeof SPECIALIST_IDS)[number], RealtimeAgent> = {
    [EMAIL_AGENT_ID]: createEmailOpsAgent(
      runtime.getSpecialistEnvironment(EMAIL_AGENT_ID, DISPLAY_NAMES[EMAIL_AGENT_ID]),
      deps.tools.email,
    ),
    [INSIGHT_AGENT_ID]: createInsightAgent(
      runtime.getSpecialistEnvironment(INSIGHT_AGENT_ID, DISPLAY_NAMES[INSIGHT_AGENT_ID]),
      deps.tools.insights,
    ),
    [CONTACTS_AGENT_ID]: createContactsAgent(
      runtime.getSpecialistEnvironment(CONTACTS_AGENT_ID, DISPLAY_NAMES[CONTACTS_AGENT_ID]),
      deps.tools.contacts,
    ),
    [CALENDAR_AGENT_ID]: createCalendarAgent(
      runtime.getSpecialistEnvironment(CALENDAR_AGENT_ID, DISPLAY_NAMES[CALENDAR_AGENT_ID]),
      deps.tools.calendar,
    ),
    [AUTOMATION_AGENT_ID]: createAutomationAgent(
      runtime.getSpecialistEnvironment(AUTOMATION_AGENT_ID, DISPLAY_NAMES[AUTOMATION_AGENT_ID]),
    ),
  };

  const routerAgent = new RealtimeAgent({
    name: 'RouterAgent',
    tools: deps.tools.sync ?? [],
    handoffs: SPECIALIST_IDS.map((id) =>
      handoff(specialists[id], {
        onHandoff: () => {
          runtime.router.progress(`[RouterAgent] Delegating to ${DISPLAY_NAMES[id]}.`);
        },
      }),
    ) as any,
    instructions: (runContext) => {
      const utterance = extractLatestUserText(((runContext?.context as any)?.history) ?? []);
      const decision = determineIntent(utterance);

      if (!decision.confident || !decision.agentId) {
        return [
          'You are the RouterAgent. You must clarify ambiguous requests before delegating.',
          `Ask ONE concise follow-up question to disambiguate the user intent. Rationale: ${decision.rationale}`,
        ].join('\n');
      }

      const specialistName = DISPLAY_NAMES[decision.agentId];
      const cacheSummary = runtime.router.scratchpads[decision.agentId].toInstructionSummary();

      return [
        'You are the RouterAgent. Immediately acknowledge the user and announce the delegation path.',
        `State: "Routing to ${specialistName}" and then invoke the corresponding handoff tool.`,
        `Rationale: ${decision.rationale}`,
        'After the specialist returns, summarise the concrete results referencing tool outputs by name.',
        'Do not invent results - only cite actual tool payloads.',
        `Specialist cache:\n${cacheSummary}`,
      ].join('\n');
    },
  });

  attachAgentLifecycle(routerAgent, ROUTER_AGENT_ID, runtime.router.callGraph);
  tagAgent(routerAgent, ROUTER_AGENT_ID);

  return {
    router: routerAgent,
    specialists,
    runtime,
  };
}

function extractLatestUserText(history: unknown[]): string {
  if (!Array.isArray(history) || !history.length) return '';
  for (let i = history.length - 1; i >= 0; i--) {
    const item: any = history[i];
    const role = item?.role || item?.author || item?.type;
    if (role === 'user' || role === 'input_audio_buffer.append' || role === 'input_text') {
      const text = extractTextFromItem(item);
      if (text) return text;
    }
  }
  return '';
}

function extractTextFromItem(item: any): string {
  if (!item) return '';
  if (typeof item === 'string') return item;
  if (typeof item.text === 'string') return item.text;
  if (typeof item.transcript === 'string') return item.transcript;
  if (Array.isArray(item.content)) {
    for (const child of item.content) {
      const text = extractTextFromItem(child);
      if (text) return text;
    }
  }
  if (typeof item.content === 'string') return item.content;
  if (typeof item.message === 'string') return item.message;
  if (typeof item.body === 'string') return item.body;
  return '';
}
