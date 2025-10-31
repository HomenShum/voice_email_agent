import { RealtimeAgent } from '@openai/agents/realtime';
import { handoff } from '@openai/agents-core';
import type { Tool } from '@openai/agents-core';
import { z } from 'zod';
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
import { createEmailOpsAgent } from './emailOpsAgent';
import { createInsightAgent } from './insightAgent';
import { createContactsAgent } from './contactsAgent';
import { createCalendarAgent } from './calendarAgent';
import { createAutomationAgent } from './automationAgent';
import { supportsEmailAnalytics, supportsEmailCounting } from '../featureFlags';

export const DISPLAY_NAMES: Record<(typeof SPECIALIST_IDS)[number], string> = {
  [EMAIL_AGENT_ID]: 'EmailOpsAgent',
  [INSIGHT_AGENT_ID]: 'InsightAgent',
  [CONTACTS_AGENT_ID]: 'ContactsAgent',
  [CALENDAR_AGENT_ID]: 'CalendarAgent',
  [AUTOMATION_AGENT_ID]: 'AutomationAgent',
};

const emailOpsCapability = supportsEmailCounting
  ? 'Email triage, LLM prioritisation (triage_recent_emails), unread listings, focused searches, message counts.'
  : 'Email triage, LLM prioritisation (triage_recent_emails), unread listings, focused hybrid search. Total message counts are unavailable in this environment.';

const insightCapability = supportsEmailAnalytics
  ? 'Analytics across emails: aggregations, trends, summaries and executive narratives using aggregate_emails and analyze_emails.'
  : 'Analytics across emails: aggregations and trend exploration via aggregate_emails, with summaries authored directly from search_emails output because analyze_emails is offline in this environment.';

export const SPECIALIST_CAPABILITIES: Record<(typeof SPECIALIST_IDS)[number], string> = {
  [EMAIL_AGENT_ID]: emailOpsCapability,
  [INSIGHT_AGENT_ID]: insightCapability,
  [CONTACTS_AGENT_ID]:
    'Contact lookup and enrichment through Nylas contacts APIs.',
  [CALENDAR_AGENT_ID]:
    'Calendar availability, event lookups, scheduling context via Nylas calendar APIs.',
  [AUTOMATION_AGENT_ID]:
    'Explains automation capabilities and outlines follow-up workflows (drafting/scheduling still limited).',
};

export const SPECIALIST_MANIFEST = [
  { id: ROUTER_AGENT_ID, name: 'RouterAgent', description: 'Primary orchestrator that interprets user intent and delegates to specialists.' },
  ...SPECIALIST_IDS.map((id) => ({
    id,
    name: DISPLAY_NAMES[id],
    description: SPECIALIST_CAPABILITIES[id],
  })),
 ];

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
        toolNameOverride: DISPLAY_NAMES[id],
        toolDescriptionOverride: SPECIALIST_CAPABILITIES[id],
        inputType: z.object({}),
        onHandoff: () => {
          runtime.router.progress(`[RouterAgent] Delegating to ${DISPLAY_NAMES[id]}.`);
        },
      }),
    ) as any,
    instructions: (runContext) => {
      const utterance = extractLatestUserText(((runContext?.context as any)?.history) ?? []);
      const latestRequest = utterance ? `"${utterance.trim()}"` : 'No new user request captured yet.';
      const capabilityLines = SPECIALIST_IDS
        .map((id) => `- ${DISPLAY_NAMES[id]}: ${SPECIALIST_CAPABILITIES[id]}`)
        .join('\n');
      const scratchpadDigest = SPECIALIST_IDS
        .map((id) => `${DISPLAY_NAMES[id]} cache:\n${runtime.router.scratchpads[id].toInstructionSummary()}`)
        .join('\n\n');

      return [
        'You are the RouterAgent orchestrating this realtime conversation.',
        `Latest user request: ${latestRequest}`,
        'Available specialists and their focus areas:',
        capabilityLines,
        'Available delegation tools (call by exact name with an empty JSON object unless additional input is required): EmailOpsAgent, InsightAgent, ContactsAgent, CalendarAgent, AutomationAgent.',
        'Your job: reason about the conversation and decide which specialist should handle the task. Do not rely on static heuristicsâ€”use judgment based on the userâ€™s actual words and context.',
        'If the request is unclear or could map to multiple specialists, ask one brief clarifying question and do not delegate yet.',
        'When confident, respond with "Routing to <SpecialistName>" and immediately invoke that specialistâ€™s handoff tool.',
        'After the specialist completes, present a concise summary that cites the actual tool outputs by name. If no tools produced data, state that transparently.',
        'Avoid fabricating capabilities or results.',
        `Scratchpad briefings:\n${scratchpadDigest}`,
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
