import { RealtimeSession } from '@openai/agents/realtime';
import {
  createRouterBundle,
  type RouterBundle,
} from './agents';
import {
  addToolCallListener,
  calendarToolset,
  contactsToolset,
  emailOpsToolset,
  insightToolset,
  syncToolset,
  type ToolCallRecord,
} from './tools';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:8787';
let activeRouterBundle: RouterBundle | null = null;

let onTranscript: undefined | ((history: unknown[]) => void);
export function setTranscriptHandler(fn: (history: unknown[]) => void) {
  onTranscript = fn;
}

function truncate(value: string, length = 80) {
  if (!value) return '';
  return value.length > length ? `${value.slice(0, length - 3)}...` : value;
}

function summarizeToolCall(record: ToolCallRecord): string {
  try {
    const data: any = record.result;
    switch (record.name) {
      case 'count_emails':
        return `total=${data?.total ?? 'n/a'}`;
      case 'search_emails':
        return `matches=${Array.isArray(data?.results) ? data.results.length : 0}`;
      case 'aggregate_emails':
        return `groups=${Array.isArray(data?.groups) ? data.groups.length : 0}`;
      case 'analyze_emails':
        return data?.summary ? `summary=${truncate(String(data.summary), 80)}` : '';
      case 'list_unread_messages':
        return `unread=${Array.isArray(data?.messages) ? data.messages.length : 0}`;
      case 'list_contacts':
        return `contacts=${Array.isArray(data?.data) ? data.data.length : 0}`;
      case 'list_events':
        return `events=${Array.isArray(data?.data) ? data.data.length : 0}`;
      default:
        if (Array.isArray(data)) return `items=${data.length}`;
        if (data && typeof data === 'object') {
          const keys = Object.keys(data);
          return keys.length ? `keys=${keys.slice(0, 3).join(',')}` : '';
        }
        return '';
    }
  } catch {
    return '';
  }
}

function wireScratchpads(bundle: RouterBundle) {
  addToolCallListener((record) => {
    if (!record.agentId) return;
    const pad = (bundle.runtime.router.scratchpads as Record<string, any>)[record.agentId];
    if (!pad || typeof pad.add !== 'function') return;
    pad.add({
      toolName: record.name,
      timestamp: record.timestamp,
      summary: record.error ? `error=${truncate(record.error, 60)}` : summarizeToolCall(record),
      parameters: record.parameters,
      result: record.result,
      filters: record.parameters?.filters ?? undefined,
    });
  });
}

export async function createVoiceSession() {
  const routerBundle = createRouterBundle({
    tools: {
      email: Array.from(emailOpsToolset),
      insights: Array.from(insightToolset),
      contacts: Array.from(contactsToolset),
      calendar: Array.from(calendarToolset),
      sync: Array.from(syncToolset),
    },
    onProgress: (message) => console.debug('[router]', message),
  });

  activeRouterBundle = routerBundle;
  wireScratchpads(routerBundle);

  const session = new RealtimeSession(routerBundle.router, {
    model: 'gpt-realtime',
    config: {
      inputAudioTranscription: { model: 'gpt-4o-mini-transcribe' },
    },
  });

  session.on?.('history_updated', (history: unknown[]) => {
    try {
      console.debug('[voice] history_updated', history);
      onTranscript?.(history);
    } catch {}
  });

  session.on?.('tool_approval_requested', (_context: any, _agent: any, request: any) => {
    try {
      console.debug('[voice] tool_approval_requested', request?.approvalItem?.name || request);
      if (request?.approvalItem && typeof session.approve === 'function') {
        session.approve(request.approvalItem);
      } else if (request?.rawItem && typeof session.approve === 'function') {
        session.approve(request.rawItem);
      }
    } catch (e) {
      console.warn('[voice] approve failed', e);
    }
  });

  const REALTIME_MODEL = 'gpt-realtime';
  const r = await fetch(`${API_BASE}/api/realtime/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: REALTIME_MODEL }),
  });
  const raw = await r.text();
  let data: any = undefined;
  try {
    data = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  if (!r.ok) {
    console.error('[realtime] session error', data || raw);
    throw new Error(`Failed to get ephemeral token: ${r.status}`);
  }
  const token = data?.client_secret?.value || data?.value || data?.secret;
  if (!token) throw new Error('No client secret returned');
  console.log('[voice] Got ephemeral token:', `${token.substring(0, 20)}...`, 'Full response:', JSON.stringify(data).substring(0, 300));

  console.log('[voice] Calling session.connect with model:', REALTIME_MODEL);
  await session.connect({ apiKey: token, model: REALTIME_MODEL });
  console.log('[voice] Connected successfully!');
  return session;
}

export function getRouterRuntime() {
  return activeRouterBundle?.runtime ?? null;
}

export function getCallGraphSnapshot() {
  return activeRouterBundle?.runtime.router.callGraph.snapshot() ?? null;
}
