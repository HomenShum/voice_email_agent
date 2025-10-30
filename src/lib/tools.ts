import { tool } from '@openai/agents/realtime';
import { z } from 'zod';
import { peekToolContext } from './agents/toolContext';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:8787';
const FUNCTIONS_BASE = (import.meta as any).env?.VITE_FUNCTIONS_BASE_URL || 'http://localhost:7071';


// UI callbacks
let onResults: undefined | ((payload: unknown) => void);
let onContacts: undefined | ((payload: unknown) => void);
let onEvents: undefined | ((payload: unknown) => void);
let onUnread: undefined | ((payload: unknown) => void);
let onSyncStatus: undefined | ((payload: unknown) => void);
let onEmailMetrics: undefined | ((payload: unknown) => void);
let onToolCall: undefined | ((toolCall: ToolCallRecord) => void);
const extraToolCallListeners = new Set<(toolCall: ToolCallRecord) => void>();

// Tool call history tracking
interface ToolCallRecord {
  id: string;
  callId?: string;
  name: string;
  timestamp: number;
  parameters: any;
  result?: any;
  error?: string;
  duration?: number;
  agentId?: string;
  parentNodeId?: string;
  graphNodeId?: string;
  depth?: number;
  filterSummary?: string;
}

let toolCallIdCounter = 0;


// Optional UI progress callback for proactive tool updates
let onToolProgress: undefined | ((message: string) => void);
export function setToolProgressHandler(fn: (message: string) => void) { onToolProgress = fn; }
function progress(msg: string) { try { onToolProgress?.(msg); } catch (_) {} }

interface LogToolCallOptions {
  name: string;
  parameters: any;
  duration: number;
  result?: any;
  error?: string;
  callId?: string;
}

function summarizeFilters(parameters: any): string | undefined {
  try {
    const filters = parameters?.filters;
    if (!filters || typeof filters !== 'object') return undefined;
    const serialized = JSON.stringify(filters);
    return serialized.length > 200 ? `${serialized.slice(0, 197)}...` : serialized;
  } catch {
    return undefined;
  }
}

function normalizeUnreadMessage(rawMessage: any) {
  if (rawMessage && typeof rawMessage === 'object' && 'raw' in rawMessage) {
    return rawMessage;
  }

  const rawFrom = Array.isArray(rawMessage?.from) ? rawMessage.from : (rawMessage?.from ? [rawMessage.from] : []);
  const primary = rawFrom?.[0] || {};
  const fromEmail = String(primary?.email || primary?.address || '').trim();
  const fromName = String(primary?.name || primary?.display_name || '').trim();
  const fromDisplay = fromEmail && fromName ? `${fromName} <${fromEmail}>` : (fromName || fromEmail || '');
  const receivedRaw = Number(rawMessage?.received_at ?? rawMessage?.date ?? 0);
  const receivedMs = Number.isFinite(receivedRaw) && receivedRaw > 0
    ? (receivedRaw > 1e12 ? receivedRaw : receivedRaw * 1000)
    : null;
  const receivedIso = receivedMs ? new Date(receivedMs).toISOString() : null;
  const receivedEpoch = receivedMs ? Math.floor(receivedMs / 1000) : null;

  return {
    id: rawMessage?.id ? String(rawMessage.id) : undefined,
    thread_id: rawMessage?.thread_id ? String(rawMessage.thread_id) : undefined,
    subject: rawMessage?.subject || '',
    snippet: rawMessage?.snippet || '',
    unread: rawMessage?.unread ?? true,
    received_at: receivedEpoch,
    received_at_iso: receivedIso,
    from: {
      email: fromEmail || undefined,
      name: fromName || undefined,
      display: fromDisplay || undefined,
    },
    raw: rawMessage,
  };
}

function normalizeUnreadPayload(raw: any) {
  if (!raw || typeof raw !== 'object') {
    return { total: 0, has_more: false, next_cursor: null, messages: [], data: [] };
  }

  const baseMessages = Array.isArray(raw.messages) ? raw.messages : (Array.isArray(raw.data) ? raw.data : []);
  const hasNormalized = baseMessages.some((m: any) => m && typeof m === 'object' && 'raw' in m);
  const messages = hasNormalized ? baseMessages : baseMessages.map((m: any) => normalizeUnreadMessage(m));
  const total = typeof raw.total === 'number'
    ? raw.total
    : typeof raw.count === 'number'
      ? raw.count
      : messages.length;
  const nextCursor = raw.next_cursor ?? raw.next_page_token ?? raw.nextPageToken ?? null;
  const hasMore = typeof raw.has_more === 'boolean' ? raw.has_more : Boolean(nextCursor);

  return {
    ...raw,
    total,
    next_cursor: nextCursor,
    has_more: hasMore,
    messages,
    data: messages,
  };
}

// Tool call tracking
export function setToolCallHandler(fn: (toolCall: ToolCallRecord) => void) { onToolCall = fn; }
export function addToolCallListener(fn: (toolCall: ToolCallRecord) => void) { extraToolCallListeners.add(fn); }
export function removeToolCallListener(fn: (toolCall: ToolCallRecord) => void) { extraToolCallListeners.delete(fn); }
function logToolCall(options: LogToolCallOptions) {
  try {
    const context = options.callId ? peekToolContext(options.callId) : undefined;
    const record: ToolCallRecord = {
      id: `tool-${++toolCallIdCounter}-${Date.now()}`,
      callId: options.callId,
      name: options.name,
      timestamp: Date.now(),
      parameters: options.parameters,
      result: options.error ? undefined : options.result,
      error: options.error,
      duration: options.duration,
      agentId: context?.agentId,
      parentNodeId: context?.parentNodeId,
      graphNodeId: context?.graphNodeId,
      depth: context?.depth,
      filterSummary: summarizeFilters(options.parameters),
    };
    onToolCall?.(record);
    for (const listener of extraToolCallListeners) {
      try { listener(record); } catch (err) { console.warn('[tools] extra listener failed', err); }
    }
  } catch (err) {
    console.warn('[tools] logToolCall failed', err);
  }
}

// Deterministic ISO-UTC week utilities and relative range resolution
let lastResolvedWeek: { start: Date; end: Date; label: string } | null = null;
const DAY_MS = 24 * 60 * 60 * 1000;
const safeTrunc = (s: string, n = 80) => (typeof s === 'string' && s.length > n ? s.slice(0, n - 1) + '...' : s || '');

function startOfISOWeekUTC(dIn: Date): Date {
  const d = new Date(Date.UTC(dIn.getUTCFullYear(), dIn.getUTCMonth(), dIn.getUTCDate()));
  const day = d.getUTCDay() || 7; // 1=Mon..7=Sun
  d.setUTCDate(d.getUTCDate() - (day - 1));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function endOfISOWeekUTC(dIn: Date): Date {
  const s = startOfISOWeekUTC(dIn);
  const e = new Date(s.getTime() + 6 * DAY_MS);
  e.setUTCHours(23, 59, 59, 999);
  return e;
}
function addDaysUTC(d: Date, days: number): Date { const out = new Date(d.getTime() + days * DAY_MS); return out; }
function formatISODate(d: Date): string { return d.toISOString().slice(0, 10); }
function isoWeekYear(dIn: Date): number {
  const d = new Date(Date.UTC(dIn.getUTCFullYear(), dIn.getUTCMonth(), dIn.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  return d.getUTCFullYear();
}
function isoWeekNumber(dIn: Date): number {
  const d = new Date(Date.UTC(dIn.getUTCFullYear(), dIn.getUTCMonth(), dIn.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.floor(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7) + 1;
}
function weekLabel(start: Date, end: Date): string {
  const y = isoWeekYear(start);
  const w = String(isoWeekNumber(start)).padStart(2, '0');
  return `Week ${y}-W${w} (${formatISODate(start)} to ${formatISODate(end)} UTC)`;
}
function computeThisWeek(now = new Date()) { const s = startOfISOWeekUTC(now); const e = endOfISOWeekUTC(now); return { start: s, end: e, label: weekLabel(s, e) }; }
function computeLastWeek(now = new Date()) { const sevenDaysAgo = addDaysUTC(now, -7); const s = startOfISOWeekUTC(sevenDaysAgo); const e = endOfISOWeekUTC(sevenDaysAgo); return { start: s, end: e, label: weekLabel(s, e) }; }
function shiftWeek(range: { start: Date; end: Date }, by: number) { const s = addDaysUTC(range.start, by * 7); const e = endOfISOWeekUTC(s); return { start: s, end: e, label: weekLabel(s, e) }; }

function extractTextLike(obj: any): string {
  try {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj?.content)) {
      for (const c of obj.content) { const t = extractTextLike(c); if (t) return t; }
    }
    if (typeof obj.content === 'string') return obj.content;
    if (typeof obj.transcript === 'string') return obj.transcript;
    for (const k of Object.keys(obj)) {
      const v: any = (obj as any)[k];
      if (typeof v === 'string' && (k.includes('text') || k.includes('transcript') || k.includes('message'))) return v;
      if (v && typeof v === 'object') { const t = extractTextLike(v); if (t) return t; }
    }
  } catch { /* noop */ }
  return '';
}

function maybeResolveRelativeWeek(details?: any): { start: Date; end: Date; label: string } | null {
  try {
    const items: any[] = details?.context?.history || [];
    let userText = '';
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const role = it?.role || it?.author || it?.type;
      if (role === 'user' || role === 'input_audio_buffer.append' || role === 'input_text') { userText = extractTextLike(it); if (userText) break; }
    }
    const t = (userText || '').toLowerCase();
    if (!t) return null;
    if (t.includes('the week before that') || t.includes('week prior to that') || t.includes('previous week')) {
      if (lastResolvedWeek) {
        lastResolvedWeek = shiftWeek(lastResolvedWeek, -1);
      } else {
        lastResolvedWeek = shiftWeek(computeLastWeek(), -1);
      }
      progress(`Resolved relative week: ${lastResolvedWeek.label}`);
      return lastResolvedWeek;
    }
    if (t.includes('last week')) {
      lastResolvedWeek = computeLastWeek();
      progress(`Resolved relative week: ${lastResolvedWeek.label}`);
      return lastResolvedWeek;
    }
    if (t.includes('this week')) {
      lastResolvedWeek = computeThisWeek();
      progress(`Resolved relative week: ${lastResolvedWeek.label}`);
      return lastResolvedWeek;
    }
  } catch { /* noop */ }
  return null;
}

function maybeResolveRelativeDays(details?: any): { start: Date; end: Date; label: string } | null {
  try {
    const items: any[] = details?.context?.history || [];
    let userText = '';
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const role = it?.role || it?.author || it?.type;
      if (role === 'user' || role === 'input_audio_buffer.append' || role === 'input_text') {
        userText = extractTextLike(it);
        if (userText) break;
      }
    }
    const t = (userText || '').toLowerCase();
    if (!t) return null;

    // Match phrases like: last 30 days, past 14 days, last 7 day
    const m = t.match(/\b(?:last|past)\s+(\d{1,3})\s+day/);
    if (m) {
      const n = Math.max(1, Math.min(365, parseInt(m[1], 10)));
      const now = new Date();
      const start = new Date(now.getTime() - n * DAY_MS);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(now.getTime());
      end.setUTCHours(23, 59, 59, 999);
      const label = `${n} day${n === 1 ? '' : 's'} (${formatISODate(start)} to ${formatISODate(end)} UTC)`;
      progress(`Resolved relative days: ${label}`);
      return { start, end, label };
    }

    // Common shorthand: "last month" / "past month" => 30 days
    if (t.includes('last month') || t.includes('past month')) {
      const n = 30;
      const now = new Date();
      const start = new Date(now.getTime() - n * DAY_MS);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(now.getTime());
      end.setUTCHours(23, 59, 59, 999);
      const label = `last month (~30 days) (${formatISODate(start)} to ${formatISODate(end)} UTC)`;
      progress(`Resolved relative days: ${label}`);
      return { start, end, label };
    }
  } catch { /* noop */ }
  return null;
}


function mergeDateFilter(filters: any | undefined | null, start: Date, end: Date) {
  const startSec = Math.floor(start.getTime() / 1000);
  const endSec = Math.floor(end.getTime() / 1000);
  const dateFilter = { date: { $gte: startSec, $lte: endSec } };
  if (!filters || typeof filters !== 'object') return dateFilter;
  const cur = (filters as any).date || {};
  return { ...filters, date: { ...cur, ...dateFilter.date } };
}

export function setSearchResultsHandler(fn: (payload: unknown) => void) { onResults = fn; }
export function setContactsHandler(fn: (payload: unknown) => void) { onContacts = fn; }
export function setEventsHandler(fn: (payload: unknown) => void) { onEvents = fn; }
export function setUnreadHandler(fn: (payload: unknown) => void) { onUnread = fn; }
export function setSyncStatusHandler(fn: (payload: unknown) => void) { onSyncStatus = fn; }
export function setEmailMetricsHandler(fn: (payload: unknown) => void) { onEmailMetrics = fn; }

export type { ToolCallRecord };

// Tools
const searchEmails = tool({
  name: 'search_emails',
  description: 'Hybrid search over emails',
  needsApproval: true,
  parameters: z.object({ text: z.string(), top_k: z.number().nullable().optional(), filters: z.record(z.any()).nullable().optional() }),
  async execute({ text, top_k, filters }, details?: any) {
    const _t0 = (globalThis.performance?.now?.() ?? Date.now());
    const callId = details?.toolCall?.id;
    const params = { text, top_k, filters };
    progress(`search_emails starting - q="${safeTrunc(text)}"${top_k ? `, top_k=${top_k}` : ''}`);
    let _range = maybeResolveRelativeWeek(details) || maybeResolveRelativeDays(details);
    if (_range) {
      filters = mergeDateFilter(filters, _range.start, _range.end);
      progress(`search_emails using ${_range.label}`);
    }

    try {
      const res = await fetch(`${API_BASE}/email/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: [{ text }], top_k, filters }),
      });
      const data = await res.json();
      const _count = Array.isArray((data as any)?.results) ? (data as any).results.length : 0;
      const _total = (data as any)?.total ?? _count;
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      progress(`search_emails finished - ${_count} item(s) of ${_total} total in ${duration}ms`);

      onResults?.(data);
      onEmailMetrics?.(data);
      logToolCall({ name: 'search_emails', callId, parameters: params, result: data, duration });
      return data;
    } catch (error) {
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      logToolCall({ name: 'search_emails', callId, parameters: params, duration, error: String(error) });
      throw error;
    }
  },
});


const listContacts = tool({
  name: 'list_contacts',
  description: 'List recent contacts from Nylas',
  needsApproval: true,
  parameters: z.object({ limit: z.number().nullable().optional().default(5) }),
  async execute({ limit }, details?: any) {
    const _t0 = (globalThis.performance?.now?.() ?? Date.now());
    const callId = details?.toolCall?.id;
    const params = { limit };
    try {
      const url = new URL(`${API_BASE}/nylas/contacts`);
      url.searchParams.set('limit', String(limit || 5));
      const res = await fetch(url);
      const data = await res.json();
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      onContacts?.(data);
      logToolCall({ name: 'list_contacts', callId, parameters: params, result: data, duration });
      return data;
    } catch (error) {
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      logToolCall({ name: 'list_contacts', callId, parameters: params, duration, error: String(error) });
      throw error;
    }
  },
});

const listEvents = tool({
  name: 'list_events',
  description: 'List recent calendar events from Nylas',
  needsApproval: true,
  parameters: z.object({ calendar_id: z.string().nullable().default('primary').optional(), limit: z.number().optional().default(5) }),
  async execute({ calendar_id, limit }, details?: any) {
    const _t0 = (globalThis.performance?.now?.() ?? Date.now());
    const callId = details?.toolCall?.id;
    const params = { calendar_id, limit };
    try {
      const url = new URL(`${API_BASE}/nylas/events`);
      if (calendar_id) url.searchParams.set('calendar_id', calendar_id);
      url.searchParams.set('limit', String(limit || 5));
      const res = await fetch(url);
      const data = await res.json();
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      onEvents?.(data);
      logToolCall({ name: 'list_events', callId, parameters: params, result: data, duration });
      return data;
    } catch (error) {
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      logToolCall({ name: 'list_events', callId, parameters: params, duration, error: String(error) });
      throw error;
    }
  },
});

const listUnreadMessages = tool({
  name: 'list_unread_messages',
  description: 'List unread messages (summary) from Nylas',
  needsApproval: true,
  parameters: z.object({ limit: z.number().optional().default(5), sinceEpoch: z.number().nullable().optional() }),
  async execute({ limit, sinceEpoch }, details?: any) {
    const _t0 = (globalThis.performance?.now?.() ?? Date.now());
    const callId = details?.toolCall?.id;
    const params = { limit, sinceEpoch };
    try {
      const url = new URL(`${API_BASE}/nylas/unread`);
      url.searchParams.set('limit', String(limit || 5));
      if (sinceEpoch) url.searchParams.set('sinceEpoch', String(sinceEpoch));
      const res = await fetch(url);
      const raw = await res.json();
      const data = normalizeUnreadPayload(raw);
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      onUnread?.(data);
      logToolCall({ name: 'list_unread_messages', callId, parameters: params, result: data, duration });
      return data;
    } catch (error) {
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      logToolCall({ name: 'list_unread_messages', callId, parameters: params, duration, error: String(error) });
      throw error;
    }
  },
});

const triageRecentEmails = tool({
  name: 'triage_recent_emails',
  description: 'Run prioritized email triage (gpt-5-mini) to surface urgent messages, actions, and validation details.',
  needsApproval: true,
  parameters: z.object({
    limit: z.number().optional().default(50),
    includeBodies: z.boolean().optional().default(true),
    grantId: z.string().trim().default(''),
  }),
  async execute({ limit, includeBodies, grantId }, details?: any) {
    const _t0 = (globalThis.performance?.now?.() ?? Date.now());
    const callId = details?.toolCall?.id;
    const effectiveGrant = typeof grantId === 'string' ? grantId.trim() : '';
    const params = { limit, includeBodies, grantId: effectiveGrant || undefined };
    const safeLimit =
      typeof limit === 'number' && Number.isFinite(limit) ? Math.max(Math.min(limit, 200), 1) : 50;
    const payload: Record<string, unknown> = { limit: safeLimit };
    if (typeof includeBodies === 'boolean') payload.includeBodies = includeBodies;
    if (effectiveGrant) payload.grantId = effectiveGrant;
    progress(
      `triage_recent_emails starting - limit=${safeLimit}${
        includeBodies === false ? ', bodies=disabled' : ''
      }`,
    );
    try {
      const res = await fetch(`${API_BASE}/email/triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new Error(
          `[triage_recent_emails] ${res.status} ${res.statusText || 'error'}${bodyText ? ` - ${bodyText}` : ''}`,
        );
      }
      const data = await res.json();
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      const status = data?.triage_summary?.status || data?.map_reduce?.status || 'unknown';
      const urgentCount =
        typeof data?.triage_summary?.metrics?.urgent_count === 'number'
          ? data.triage_summary.metrics.urgent_count
          : Array.isArray(data?.map_reduce?.top_emails)
            ? data.map_reduce.top_emails.length
            : 0;
      progress(`triage_recent_emails finished - status=${status}, urgent=${urgentCount} in ${duration}ms`);
      logToolCall({ name: 'triage_recent_emails', callId, parameters: params, result: data, duration });
      return data;
    } catch (error) {
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      logToolCall({ name: 'triage_recent_emails', callId, parameters: params, duration, error: String(error) });
      throw error;
    }
  },
});

const listRecentEmails = tool({
  name: 'list_recent_emails',
  description: 'Fetch the most recent emails (up to 200) and run LLM MapReduce prioritization',
  needsApproval: true,
  parameters: z.object({
    limit: z.number().optional().default(50),
    includeBodies: z.boolean().optional().default(true),
  }),
  async execute({ limit, includeBodies }, details?: any) {
    const _t0 = (globalThis.performance?.now?.() ?? Date.now());
    const callId = details?.toolCall?.id;
    const params = { limit, includeBodies };
    const safeLimit = typeof limit === 'number' && Number.isFinite(limit) ? Math.max(Math.min(limit, 200), 1) : 50;
    progress(`list_recent_emails starting - limit=${safeLimit}${includeBodies === false ? ', bodies=disabled' : ''}`);
    try {
      const url = new URL(`${API_BASE}/nylas/messages/recent`);
      url.searchParams.set('limit', String(safeLimit));
      if (includeBodies === false) url.searchParams.set('includeBodies', 'false');
      if (includeBodies === true) url.searchParams.set('includeBodies', 'true');
      const res = await fetch(url);
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        const message = `[list_recent_emails] ${res.status} ${res.statusText || 'error'}${bodyText ? ` — ${bodyText}` : ''}`;
        progress(`${message}. Falling back to list_unread_messages.`);

        const fallbackUrl = new URL(`${API_BASE}/nylas/unread`);
        fallbackUrl.searchParams.set('limit', String(Math.min(safeLimit, 50)));
        const fallbackRes = await fetch(fallbackUrl);
        if (!fallbackRes.ok) {
          const fallbackText = await fallbackRes.text().catch(() => '');
          throw new Error(`${message}; fallback unread fetch failed ${fallbackRes.status} ${fallbackRes.statusText || ''}${fallbackText ? ` — ${fallbackText}` : ''}`.trim());
        }

        const fallbackData = await fallbackRes.json();
        const messages = Array.isArray(fallbackData?.messages)
          ? fallbackData.messages
          : (Array.isArray(fallbackData?.data) ? fallbackData.data : []);

        const normalizedFallback = {
          source: 'fallback-unread',
          messages,
          map_reduce: {
            status: 'unavailable',
            error: 'RECENT_ENDPOINT_UNAVAILABLE',
            note: `Primary endpoint returned ${res.status}. Provided unread list instead.`,
          },
        };

        const durationFallback = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
        logToolCall({ name: 'list_recent_emails', callId, parameters: params, result: normalizedFallback, duration: durationFallback });
        return normalizedFallback;
      }

      const data = await res.json();
      const returned = Array.isArray((data as any)?.messages) ? (data as any).messages.length : 0;
      const topCount = Array.isArray((data as any)?.map_reduce?.top_emails) ? (data as any).map_reduce.top_emails.length : 0;
      const status = (data as any)?.map_reduce?.status || 'unknown';
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      const summaryTail = topCount ? `, ${topCount} high-priority candidate(s)` : '';
      progress(`list_recent_emails finished - ${returned} message(s) in ${duration}ms (MapReduce: ${status}${summaryTail})`);
      logToolCall({ name: 'list_recent_emails', callId, parameters: params, result: data, duration });
      return data;
    } catch (error) {
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      logToolCall({ name: 'list_recent_emails', callId, parameters: params, duration, error: String(error) });
      throw error;
    }
  },
});

const startSync = tool({
  name: 'sync_start',
  description: 'Kick off on-login unread sync for the signed-in user',
  needsApproval: true,
  parameters: z.object({ sinceEpoch: z.number().nullable().optional(), limit: z.number().nullable().optional().default(25) }),
  async execute({ sinceEpoch, limit }, details?: any) {
    const _t0 = (globalThis.performance?.now?.() ?? Date.now());
    const callId = details?.toolCall?.id;
    const params = { sinceEpoch, limit };
    try {
      const res = await fetch(`${API_BASE}/sync/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sinceEpoch, limit }),
      });
      const data = await res.json();
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      onSyncStatus?.(data);
      logToolCall({ name: 'sync_start', callId, parameters: params, result: data, duration });
      return data;
    } catch (error) {
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      logToolCall({ name: 'sync_start', callId, parameters: params, duration, error: String(error) });
      throw error;
    }
  },
});


const startBackfill = tool({
  name: 'backfill_start',
  description: 'Kick off historical backfill of emails (Azure Functions)',
  needsApproval: true,
  parameters: z.object({
    grantId: z.string(),
    months: z.number().nullable().optional().default(12),
    max: z.number().nullable().optional().default(10000),
  }),
  async execute({ grantId, months, max }, details?: any) {
    const _t0 = (globalThis.performance?.now?.() ?? Date.now());
    const callId = details?.toolCall?.id;
    const params = { grantId, months, max };
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/api/sync/backfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grantId, months, max }),
      });
      const data = await res.json();
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      onSyncStatus?.(data);
      logToolCall({ name: 'backfill_start', callId, parameters: params, result: data, duration });
      return data;
    } catch (error) {
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      logToolCall({ name: 'backfill_start', callId, parameters: params, duration, error: String(error) });
      throw error;
    }
  },
});

const aggregateEmails = tool({
  name: 'aggregate_emails',
  description: 'Aggregate counts grouped by metadata fields over filtered results',
  needsApproval: true,
  parameters: z.object({
    metric: z.enum(['count']).default('count'),
    group_by: z.array(z.string()).nullable().optional(),
    filters: z.record(z.any()).nullable().optional(),
    top_k: z.number().nullable().optional(),
  }),
  async execute({ metric, group_by, filters, top_k }, details?: any) {
    const _t0 = (globalThis.performance?.now?.() ?? Date.now());
    const callId = details?.toolCall?.id;
    const params = { metric, group_by, filters, top_k };
    progress(`aggregate_emails starting - metric=${metric}${group_by ? `, group_by=${group_by.join(',')}` : ''}`);
    let _range = maybeResolveRelativeWeek(details) || maybeResolveRelativeDays(details);
    if (_range) {
      filters = mergeDateFilter(filters, _range.start, _range.end);
      progress(`aggregate_emails using ${_range.label}`);
    }

    try {
      const res = await fetch(`${API_BASE}/email/aggregate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metric, group_by, filters, top_k }),
      });
      const data = await res.json();
      const _count = Array.isArray((data as any)?.groups) ? (data as any).groups.length : (typeof (data as any)?.count === 'number' ? (data as any).count : 0);
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      progress(`aggregate_emails finished - ${_count} group(s) in ${duration}ms`);
      logToolCall({ name: 'aggregate_emails', callId, parameters: params, result: data, duration });
      return data;
    } catch (error) {
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      logToolCall({ name: 'aggregate_emails', callId, parameters: params, duration, error: String(error) });
      throw error;
    }
  },
});

const analyzeEmails = tool({
  name: 'analyze_emails',
  description: 'Summarize top results (bullets, paragraph, tags) given a query and optional filters',
  needsApproval: true,
  parameters: z.object({ text: z.string(), filters: z.record(z.any()).nullable().optional(), top_k: z.number().nullable().optional() }),
  async execute({ text, filters, top_k }, details?: any) {
    const _t0 = (globalThis.performance?.now?.() ?? Date.now());
    const callId = details?.toolCall?.id;
    const params = { text, filters, top_k };
    progress(`analyze_emails starting - q="${safeTrunc(text)}"${top_k ? `, top_k=${top_k}` : ''}`);
    let _range = maybeResolveRelativeWeek(details) || maybeResolveRelativeDays(details);
    if (_range) {
      filters = mergeDateFilter(filters, _range.start, _range.end);
      progress(`analyze_emails using ${_range.label}`);
    }

    try {
      const res = await fetch(`${API_BASE}/email/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, filters, top_k }),
      });
      const data = await res.json();
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      progress(`analyze_emails finished - ${duration}ms`);
      logToolCall({ name: 'analyze_emails', callId, parameters: params, result: data, duration });
      return data;
    } catch (error) {
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      logToolCall({ name: 'analyze_emails', callId, parameters: params, duration, error: String(error) });
      throw error;
    }
  },
});

const countEmails = tool({
  name: 'count_emails',
  description: 'Get the total count of all emails indexed in the system (Pinecone vector store)',
  needsApproval: true,
  parameters: z.object({ filters: z.record(z.any()).nullable().optional() }),
  async execute({ filters }, details?: any) {
    const _t0 = (globalThis.performance?.now?.() ?? Date.now());
    const callId = details?.toolCall?.id;
    const params = { filters };
    progress(`count_emails starting${filters ? ' with filters' : ''}`);
    let _range = maybeResolveRelativeWeek(details) || maybeResolveRelativeDays(details);
    if (_range) {
      filters = mergeDateFilter(filters, _range.start, _range.end);
      progress(`count_emails using ${_range.label}`);
    }

    try {
      const res = await fetch(`${API_BASE}/email/count`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
      });
      const data = await res.json();
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      const total = (data as any)?.total ?? 0;
      progress(`count_emails finished - ${total} total emails in ${duration}ms`);
      logToolCall({ name: 'count_emails', callId, parameters: params, result: data, duration });
      return data;
    } catch (error) {
      const duration = Math.round((globalThis.performance?.now?.() ?? Date.now()) - _t0);
      logToolCall({ name: 'count_emails', callId, parameters: params, duration, error: String(error) });
      throw error;
    }
  },
});


export const emailOpsToolset = [triageRecentEmails, searchEmails, listUnreadMessages, listRecentEmails, countEmails] as const;
export const insightToolset = [aggregateEmails, analyzeEmails, countEmails] as const;
export const contactsToolset = [listContacts] as const;
export const calendarToolset = [listEvents] as const;
export const syncToolset = [startSync, startBackfill] as const;

export function registerTools() {
  return Array.from(
    new Set([
      ...emailOpsToolset,
      ...insightToolset,
      ...contactsToolset,
      ...calendarToolset,
      ...syncToolset,
    ]),
  );
}
