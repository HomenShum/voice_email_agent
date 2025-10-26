import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';
import { registerTools } from './tools';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:8787';

let onTranscript: undefined | ((history: unknown[]) => void);
export function setTranscriptHandler(fn: (history: unknown[]) => void) {
  onTranscript = fn;
}



export async function createVoiceSession() {
  const agent = new RealtimeAgent({
    name: 'Assistant',
    instructions:
      'You are a helpful voice assistant. Be concise. Always reply with a short 1-2 sentence acknowledgement/plan before any tool calls; then, if needed, call tools; after tools complete, provide a final answer based on the actual tool results. Announce when you are about to execute a tool with a brief one-liner to buy time (e.g., \'Got it — checking now.\'). IMPORTANT: When tools return data, you MUST read and report the actual results - never say you don\'t have access if the tool call succeeded. Tool usage: When users ask for the TOTAL count of ALL messages/emails (e.g., "how many messages do I have in total"), use count_emails which returns the total number of indexed emails from Pinecone. When users ask "what emails do I have" or want recent unread, use list_unread_messages. When the user asks about email content or wants to search, use search_emails. For breakdowns by category/domain/sender, call aggregate_emails with an appropriate group_by (e.g., from_domain). For executive summaries over results, call analyze_emails. You can also use list_contacts for contacts and list_events for calendar events. Use the filters parameter on these tools when the user specifies constraints (e.g., unread, from, date ranges). Time ranges: Interpret \'last week\' and \'the week before that\' using ISO weeks in UTC (Monday-Sunday). \'The week before that\' means the ISO week prior to the previously referenced week. For relative ranges like \'past N days\' or \'last N days\', compute the day span (now−N days to now) and include this as a date filter. When the user asks for \'emails in the past N days\', first call search_emails with the date filter (to populate the dashboard total and top 10), and optionally call count_emails for the total count. Always cite the explicit range in your answer as: Week YYYY-Www (Mon YYYY-MM-DD to Sun YYYY-MM-DD UTC) or, for day spans, (YYYY-MM-DD to YYYY-MM-DD UTC).',
    tools: registerTools(),
  });

  const session = new RealtimeSession(agent, {
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
  // Auto-approve tool calls so the model can announce first, then execute quickly
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


  const REALTIME_MODEL = 'gpt-realtime'; // GA model; falls back to preview if not enabled
  const r = await fetch(`${API_BASE}/api/realtime/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: REALTIME_MODEL }),
  });
  const raw = await r.text();
  let data: any = undefined;
  try { data = JSON.parse(raw); } catch { /* ignore */ }
  if (!r.ok) {
    console.error('[realtime] session error', data || raw);
    throw new Error(`Failed to get ephemeral token: ${r.status}`);
  }
  const token = (data?.client_secret?.value) || data?.value || data?.secret;
  if (!token) throw new Error('No client secret returned');
  console.log('[voice] Got ephemeral token:', token.substring(0, 20) + '...', 'Full response:', JSON.stringify(data).substring(0, 300));

  console.log('[voice] Calling session.connect with model:', REALTIME_MODEL);
  await session.connect({ apiKey: token, model: REALTIME_MODEL }); // WebRTC in-browser
  console.log('[voice] Connected successfully!');
  return session;
}

