import { tool } from '@openai/agents';
import { z } from 'zod';
import { embedText } from './openai.js';
import { generateSparseEmbedding, hybridQuery } from './pinecone.js';


/**
 * Server-side tools for the backend agent
 * These tools run in Azure Functions with direct access to Pinecone, Nylas, etc.
 */

const NYLAS_BASE = process.env.NYLAS_BASE || 'https://api.us.nylas.com/v3';

// Helper to get Nylas API key for a grant
function getNylasApiKey(grantId: string): string {
  // In production, load from Azure Key Vault or environment variables
  const apiKey = process.env.NYLAS_API_KEY || process.env[`NYLAS_KEY_${grantId}`];
  if (!apiKey) {
    throw new Error(`No Nylas API key found for grant ${grantId}`);
  }
  return apiKey;
}

/**
 * Search emails using hybrid vector + sparse search
 */
export function createSearchEmailsTool(grantId: string, onEvent?: (e: any) => void) {
  return tool({
    name: 'search_emails',
    description: 'Search emails using hybrid vector + sparse search. Returns relevant emails matching the query.',
    parameters: z.object({
      query: z.string().describe('Natural language search query'),
      topK: z.number().optional().default(10).describe('Number of results to return'),
      dateFrom: z.string().optional().describe('Filter emails from this date (ISO 8601)'),
      dateTo: z.string().optional().describe('Filter emails to this date (ISO 8601)'),
    }),
    async execute({ query, topK, dateFrom, dateTo }) {
      const _t0 = Date.now();
      onEvent?.({ type: 'tool_call_started', toolName: 'search_emails', grantId, parameters: { query, topK, dateFrom, dateTo }, timestamp: _t0 });
      // Generate embeddings
      const vec = await embedText(query);
      const sparseEmbedding = await generateSparseEmbedding(query, 'query');

      // Build filter
      const filter: Record<string, any> = { grant_id: grantId };
      if (dateFrom || dateTo) {
        filter.date = {};
        if (dateFrom) filter.date.$gte = dateFrom;
        if (dateTo) filter.date.$lte = dateTo;
      }

      // Execute hybrid query
      const results = await hybridQuery({
        namespace: grantId,
        vector: vec,
        sparseEmbedding,
        topK,
        filter,
      });

      const _result = {
        results: results.matches.map((r: any) => ({
          id: r.id,
          score: r.score,
          subject: r.metadata?.subject,
          from: r.metadata?.from,
          date: r.metadata?.date,
          snippet: r.metadata?.snippet || r.metadata?.body?.slice(0, 200),
          thread_id: r.metadata?.thread_id,
        })),
        count: results.matches.length,
      };
      onEvent?.({ type: 'tool_call_completed', toolName: 'search_emails', grantId, durationMs: Date.now() - _t0, result: { count: _result.count } , timestamp: Date.now() });
      return _result;
    },
  });
}

/**
 * Aggregate emails by metadata fields
 */
export function createAggregateEmailsTool(grantId: string, onEvent?: (e: any) => void) {
  return tool({
    name: 'aggregate_emails',
    description: 'Aggregate email counts grouped by metadata fields (e.g., from_domain, date). Useful for analytics and insights.',
    parameters: z.object({
      groupBy: z.string().describe('Metadata field to group by (e.g., "from_domain", "date", "has_attachments")'),
      dateFrom: z.string().optional().describe('Filter emails from this date (ISO 8601)'),
      dateTo: z.string().optional().describe('Filter emails to this date (ISO 8601)'),
    }),
    async execute({ groupBy, dateFrom, dateTo }) {
      const _t0 = Date.now();
      onEvent?.({ type: 'tool_call_started', toolName: 'aggregate_emails', grantId, parameters: { groupBy, dateFrom, dateTo }, timestamp: _t0 });
      // This is a simplified implementation
      // In production, you'd query Pinecone with aggregations or use a separate analytics store
      const filter: Record<string, any> = { grant_id: grantId };
      if (dateFrom || dateTo) {
        filter.date = {};
        if (dateFrom) filter.date.$gte = dateFrom;
        if (dateTo) filter.date.$lte = dateTo;
      }

      // For now, return a placeholder response
      // TODO: Implement actual aggregation logic
      const _result = {
        groupBy,
        aggregations: [],
        message: 'Aggregation tool is a placeholder. Implement actual aggregation logic.',
      };
      onEvent?.({ type: 'tool_call_completed', toolName: 'aggregate_emails', grantId, durationMs: Date.now() - _t0, result: { groupBy: _result.groupBy, aggregations: _result.aggregations?.length || 0 }, timestamp: Date.now() });
      return _result;
    },
  });
}

/**
 * List unread messages from Nylas
 */
export function createListUnreadTool(grantId: string, onEvent?: (e: any) => void) {
  return tool({
    name: 'list_unread_messages',
    description: 'List unread messages from Nylas. Returns recent unread emails.',
    parameters: z.object({
      limit: z.number().optional().default(10).describe('Maximum number of unread messages to return'),
    }),
    async execute({ limit }) {
      const _t0 = Date.now();
      onEvent?.({ type: 'tool_call_started', toolName: 'list_unread_messages', grantId, parameters: { limit }, timestamp: _t0 });
      const apiKey = getNylasApiKey(grantId);
      const url = new URL(`${NYLAS_BASE}/grants/${grantId}/messages`);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('unread', 'true');

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Nylas API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { data: any[] };
      const _result = {
        unread: data.data.map((msg: any) => ({
          id: msg.id,
          subject: msg.subject,
          from: msg.from?.[0]?.email,
          date: msg.date,
          snippet: msg.snippet,
          thread_id: msg.thread_id,
        })),
        count: data.data.length,
      };
      onEvent?.({ type: 'tool_call_completed', toolName: 'list_unread_messages', grantId, durationMs: Date.now() - _t0, result: { count: _result.count }, timestamp: Date.now() });
      return _result;
    },
  });
}

/**
 * List contacts from Nylas
 */
export function createListContactsTool(grantId: string, onEvent?: (e: any) => void) {
  return tool({
    name: 'list_contacts',
    description: 'List contacts from Nylas. Returns recent contacts.',
    parameters: z.object({
      limit: z.number().optional().default(10).describe('Maximum number of contacts to return'),
    }),
    async execute({ limit }) {
      const _t0 = Date.now();
      onEvent?.({ type: 'tool_call_started', toolName: 'list_contacts', grantId, parameters: { limit }, timestamp: _t0 });
      const apiKey = getNylasApiKey(grantId);
      const url = new URL(`${NYLAS_BASE}/grants/${grantId}/contacts`);
      url.searchParams.set('limit', String(limit));

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Nylas API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { data: any[] };
      const _result = {
        contacts: data.data.map((contact: any) => ({
          id: contact.id,
          name: contact.given_name ? `${contact.given_name} ${contact.surname || ''}`.trim() : contact.email,
          email: contact.emails?.[0]?.email || contact.email,
          company: contact.company_name,
        })),
        count: data.data.length,
      };
      onEvent?.({ type: 'tool_call_completed', toolName: 'list_contacts', grantId, durationMs: Date.now() - _t0, result: { count: _result.count }, timestamp: Date.now() });
      return _result;
    },
  });
}

/**
 * List calendar events from Nylas
 */
export function createListEventsTool(grantId: string, onEvent?: (e: any) => void) {
  return tool({
    name: 'list_events',
    description: 'List calendar events from Nylas. Returns upcoming events.',
    parameters: z.object({
      limit: z.number().optional().default(10).describe('Maximum number of events to return'),
      calendarId: z.string().optional().default('primary').describe('Calendar ID to query'),
    }),
    async execute({ limit, calendarId }) {
      const _t0 = Date.now();
      onEvent?.({ type: 'tool_call_started', toolName: 'list_events', grantId, parameters: { limit, calendarId }, timestamp: _t0 });
      const apiKey = getNylasApiKey(grantId);
      const url = new URL(`${NYLAS_BASE}/grants/${grantId}/events`);
      url.searchParams.set('limit', String(limit));
      if (calendarId) url.searchParams.set('calendar_id', calendarId);

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Nylas API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { data: any[] };
      const _result = {
        events: data.data.map((event: any) => ({
          id: event.id,
          title: event.title,
          description: event.description,
          start: event.when?.start_time,
          end: event.when?.end_time,
          location: event.location,
          participants: event.participants?.map((p: any) => p.email),
        })),
        count: data.data.length,
      };
      onEvent?.({ type: 'tool_call_completed', toolName: 'list_events', grantId, durationMs: Date.now() - _t0, result: { count: _result.count }, timestamp: Date.now() });
      return _result;
    },
  });
}

/**
 * Triage recent emails (simplified version)
 */
export function createTriageRecentEmailsTool(grantId: string, onEvent?: (e: any) => void) {
  return tool({
    name: 'triage_recent_emails',
    description: 'Triage recent emails to identify urgent, important, and actionable messages. Returns prioritized email list with triage summary.',
    parameters: z.object({
      limit: z.number().optional().default(50).describe('Number of recent emails to triage'),
    }),
    async execute({ limit }) {
      const _t0 = Date.now();
      onEvent?.({ type: 'tool_call_started', toolName: 'triage_recent_emails', grantId, parameters: { limit }, timestamp: _t0 });
      // Generate embeddings for recent emails query
      const vec = await embedText('recent emails');
      const sparseEmbedding = await generateSparseEmbedding('recent emails', 'query');

      // Execute hybrid query
      const results = await hybridQuery({
        namespace: grantId,
        vector: vec,
        sparseEmbedding,
        topK: limit,
        filter: { grant_id: grantId },
      });

      // For now, return the results with a simple triage note
      // TODO: Implement actual triage logic with gpt-5-mini
      const _result = {
        results: results.matches.map((r: any) => ({
          id: r.id,
          score: r.score,
          subject: r.metadata?.subject,
          from: r.metadata?.from,
          date: r.metadata?.date,
          snippet: r.metadata?.snippet || r.metadata?.body?.slice(0, 200),
          thread_id: r.metadata?.thread_id,
        })),
        count: results.matches.length,
        triage_summary: `Analyzed ${results.matches.length} recent emails. Implement actual triage logic with gpt-5-mini for detailed prioritization.`,
        urgent_count: 0,
        important_count: 0,
      };
      onEvent?.({ type: 'tool_call_completed', toolName: 'triage_recent_emails', grantId, durationMs: Date.now() - _t0, result: { count: _result.count }, timestamp: Date.now() });
      return _result;
    },
  });
}

/**
 * Create all tools for a given grantId
 */
export function createAgentTools(grantId: string, onEvent?: (e: any) => void) {
  return {
    email: [
      createSearchEmailsTool(grantId, onEvent),
      createListUnreadTool(grantId, onEvent),
      createTriageRecentEmailsTool(grantId, onEvent),
    ],
    insights: [
      createAggregateEmailsTool(grantId, onEvent),
      createSearchEmailsTool(grantId, onEvent), // Insights can also search
    ],
    contacts: [
      createListContactsTool(grantId, onEvent),
    ],
    calendar: [
      createListEventsTool(grantId, onEvent),
    ],
  };
}

