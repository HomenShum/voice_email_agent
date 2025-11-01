import { createHybridVoiceAgent, type HybridVoiceAgent } from './hybridVoiceAgent';
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
let activeHybridAgent: HybridVoiceAgent | null = null;

let onTranscript: undefined | ((history: unknown[]) => void);
let onRouterProgress: undefined | ((message: string) => void);

// Track last processed user utterance to avoid duplicate processing
let lastProcessedUserText = "";

function extractTextFromHistoryItem(item: any): string {
  if (!item) return '';
  const seen = new Set<any>();
  function walk(node: any, depth = 0): string[] {
    if (!node || typeof node === 'function' || seen.has(node) || depth > 4) return [];
    if (typeof node === 'string') return [node];
    if (typeof node !== 'object') return [];
    seen.add(node);
    const out: string[] = [];
    if (typeof node.text === 'string') out.push(node.text);
    if (typeof node.transcript === 'string') out.push(node.transcript);
    if (typeof node.content === 'string') out.push(node.content);
    if (Array.isArray(node.content)) for (const c of node.content) out.push(...walk(c, depth + 1));
    for (const k of Object.keys(node)) {
      if (k === 'text' || k === 'transcript' || k === 'content') continue;
      const v: any = (node as any)[k];
      if (typeof v === 'string') {
        if (k.includes('text') || k.includes('transcript') || k.includes('message')) out.push(v);
      } else if (Array.isArray(v)) {
        for (const el of v) out.push(...walk(el, depth + 1));
      } else if (v && typeof v === 'object') {
        out.push(...walk(v, depth + 1));
      }
    }
    return out;
  }
  return walk(item).join(' ').trim();
}

export function setTranscriptHandler(fn: (history: unknown[]) => void) {
  onTranscript = fn;
}

export function setRouterProgressHandler(fn: (message: string) => void) {
  onRouterProgress = fn;
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
      case 'triage_recent_emails': {
        const urgent =
          typeof data?.triage_summary?.metrics?.urgent_count === 'number'
            ? data.triage_summary.metrics.urgent_count
            : Array.isArray(data?.map_reduce?.top_emails)
              ? data.map_reduce.top_emails.length
              : 0;
        const status = data?.triage_summary?.status || data?.map_reduce?.status;
        const model = data?.triage_summary?.model;
        const pieces = [`urgent=${urgent}`];
        if (status) pieces.push(`status=${status}`);
        if (model) pieces.push(`model=${model}`);
        return pieces.join(', ');
      }
      case 'list_recent_emails': {
        const top = Array.isArray(data?.map_reduce?.top_emails) ? data.map_reduce.top_emails.length : 0;
        const status = data?.map_reduce?.status || 'unknown';
        return `status=${status}, top=${top}`;
      }
      case 'list_unread_messages':
        return `unread=${typeof data?.total === 'number' ? data.total : (Array.isArray(data?.messages) ? data.messages.length : 0)}`;
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

function wireScratchpads(hybrid: HybridVoiceAgent) {
  addToolCallListener((record) => {
    if (!record.agentId) return;
    const pads = hybrid.getScratchpads() as Record<string, any>;
    const pad = pads?.[record.agentId];
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
  // Create and connect the Hybrid Voice Agent (voice narration + backend processing)
  const hybrid = await createHybridVoiceAgent({
    tools: {
      email: Array.from(emailOpsToolset),
      insights: Array.from(insightToolset),
      contacts: Array.from(contactsToolset),
      calendar: Array.from(calendarToolset),
      sync: Array.from(syncToolset),
    },
    voice: 'alloy',
    apiBaseUrl: API_BASE,
    onProgress: (message: string) => {
      console.debug('[hybrid][progress]', message);
      try {
        onRouterProgress?.(message);
      } catch (error) {
        console.warn('[voice] router progress handler failed', error);
      }
    },
    onTranscript: (history: unknown[]) => {
      try {
        console.debug('[hybrid][transcript]', history);
        onTranscript?.(history);
        // Detect latest user utterance and trigger backend processing
        const items = Array.isArray(history) ? history : [];
        const last: any = items.length ? items[items.length - 1] : null;
        const role = (last && (last.role || last.author || last.speaker)) || '';
        if (role === 'user') {
          const text = extractTextFromHistoryItem(last);
          if (text && text !== lastProcessedUserText) {
            lastProcessedUserText = text;
            // Fire and forget; backend will stream events to voice narrator
            void hybrid.processRequest(text);
          }
        }
      } catch (error) {
        console.warn('[voice] transcript handler failed', error);
      }
    },
    onBackendEvent: (event) => {
      console.debug('[hybrid][backend-event]', event?.type);
    },
    onUIDashboardEvent: (event) => {
      console.debug('[hybrid][ui-event]', event?.type);
    },
  });

  activeHybridAgent = hybrid;
  wireScratchpads(hybrid);
  return hybrid;
}

export function getRouterRuntime() {
  // Router runtime is not exposed in the hybrid architecture
  return null as any;
}

export function getCallGraphSnapshot() {
  try {
    return activeHybridAgent?.getCallGraph().snapshot() ?? null;
  } catch {
    return null;
  }
}
