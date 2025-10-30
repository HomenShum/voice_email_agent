import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load .env FIRST before importing other modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');
console.log(`[server] Loading .env from: ${envPath}`);
const envResult = loadEnv({ path: envPath });
console.log(`[server] .env loaded: ${envResult.parsed ? Object.keys(envResult.parsed).length + ' vars' : 'failed'}`);

import http from 'node:http';
import { URL } from 'node:url';
import crypto from 'node:crypto';
import { embedTexts } from './embedding.js';
import { upsertVectors, queryTopK } from './pineconeClient.js';
import { listContacts, listEvents, listUnreadMessages, listMessagesPage } from './nylasClient.js';
import { reloadGrantsFromEnv } from './nylasConfig.js';

// Reload grants after .env is loaded
reloadGrantsFromEnv();


const PORT = Number(process.env.PORT || 8787);

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // dev-only; tighten in prod
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function readJson(req) {
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function stripHtml(html) {
  try {
    return html.replace(/<[^>]*>/g, ' ');
  } catch {
    return '';
  }
}

function chunkText(text, maxChars = 3500, overlap = 400) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + maxChars);
    chunks.push(text.slice(i, end));
    if (end === text.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks;
}

function parseEnvList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

const PRIORITY_HINT_SENDERS = parseEnvList(process.env.PRIORITY_HINT_SENDERS || process.env.PRIORITY_SENDERS);
const PRIORITY_HINT_DOMAINS = parseEnvList(process.env.PRIORITY_HINT_DOMAINS || process.env.PRIORITY_SENDER_DOMAINS || process.env.PRIORITY_DOMAINS);
const PRIORITY_HINT_KEYWORDS = parseEnvList(process.env.PRIORITY_HINT_KEYWORDS || process.env.PRIORITY_KEYWORDS);
const PRIORITY_MODEL = process.env.PRIORITY_MODEL || process.env.OPENAI_PRIORITY_MODEL || 'gpt-5-mini';
const PRIORITY_CHUNK_SIZE = Math.max(1, Math.min(Number(process.env.PRIORITY_MAP_CHUNK || 8), 12));
const PRIORITY_MAX_BODY_CHARS = Math.max(400, Math.min(Number(process.env.PRIORITY_BODY_CHARS || 1600), 6000));
const PRIORITY_MAX_CANDIDATES = Math.max(3, Math.min(Number(process.env.PRIORITY_MAX_CANDIDATES || 12), 30));

function maybeDecodeBase64(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const base64Pattern = /^[A-Za-z0-9+/=\r\n]+$/;
  if (!base64Pattern.test(trimmed) || trimmed.replace(/[\r\n]/g, '').length % 4 !== 0) {
    return value;
  }
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (!decoded.trim()) return value;
    return decoded;
  } catch {
    return value;
  }
}

function normalizeWhitespace(text) {
  return text ? text.replace(/\s+/g, ' ').trim() : '';
}

function normalizeAddressList(list) {
  if (!list) return [];
  const entries = Array.isArray(list) ? list : [list];
  return entries
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (!trimmed) return null;
        const match = trimmed.match(/^(.*?)\s*<([^>]+)>$/);
        if (match) {
          const name = normalizeWhitespace(match[1]);
          const email = match[2].trim().toLowerCase();
          const display = name ? `${name} <${email}>` : email;
          return { name: name || undefined, email, display };
        }
        if (trimmed.includes('@')) {
          const email = trimmed.toLowerCase();
          return { name: undefined, email, display: trimmed };
        }
        return { name: trimmed, email: undefined, display: trimmed };
      }
      const email = (entry.email || entry.address || '').toLowerCase() || undefined;
      const name = entry.name || entry.display_name || entry.given_name || undefined;
      const display = name && email ? `${name} <${email}>` : (name || email || undefined);
      return { name, email, display };
    })
    .filter(Boolean);
}

function toEpochSeconds(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (num > 1e12) return Math.floor(num / 1000);
  return Math.floor(num);
}

function toIsoFromEpoch(epochSeconds) {
  if (!epochSeconds) return null;
  try {
    return new Date(epochSeconds * 1000).toISOString();
  } catch {
    return null;
  }
}

function extractPlainText(message) {
  if (!message || typeof message !== 'object') return '';
  const candidates = [];
  if (typeof message.body_text === 'string') candidates.push(message.body_text);
  if (typeof message.text_body === 'string') candidates.push(message.text_body);
  if (typeof message.body === 'string') candidates.push(message.body);
  if (typeof message.body_html === 'string') candidates.push(stripHtml(message.body_html));
  if (typeof message.snippet === 'string') candidates.push(message.snippet);
  if (typeof message.summary === 'string') candidates.push(message.summary);

  if (Array.isArray(message.body)) {
    for (const part of message.body) {
      if (!part) continue;
      const type = String(part.content_type || part.type || '').toLowerCase();
      const data = typeof part.data === 'string' ? part.data : (typeof part.body === 'string' ? part.body : null);
      if (!data) continue;
      const decoded = maybeDecodeBase64(data);
      if (type.includes('text/plain')) {
        candidates.unshift(decoded);
      } else if (type.includes('text/html')) {
        candidates.push(stripHtml(decoded));
      } else {
        candidates.push(decoded);
      }
    }
  }

  for (const candidate of candidates) {
    const normalized = normalizeWhitespace(typeof candidate === 'string' ? candidate : '');
    if (normalized) return normalized;
  }

  return '';
}

function chunkArray(items, chunkSize) {
  const size = Math.max(1, chunkSize || 1);
  const output = [];
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
}

function safeJsonParse(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}$/m);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function formatHintsForPrompt() {
  const parts = [];
  if (PRIORITY_HINT_SENDERS.length) parts.push(`VIP senders: ${PRIORITY_HINT_SENDERS.join(', ')}`);
  if (PRIORITY_HINT_DOMAINS.length) parts.push(`VIP domains: ${PRIORITY_HINT_DOMAINS.join(', ')}`);
  if (PRIORITY_HINT_KEYWORDS.length) parts.push(`High-alert keywords: ${PRIORITY_HINT_KEYWORDS.join(', ')}`);
  return parts.length ? parts.join(' | ') : 'None provided';
}

async function callChatCompletion({ systemPrompt, userPrompt, temperature = 0, maxTokens = 800 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY for priority analysis');

  const payload = {
    model: PRIORITY_MODEL,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };

  async function execute(withJsonMode) {
    const requestBody = withJsonMode ? { ...payload, response_format: { type: 'json_object' } } : payload;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
  }

  let { ok, status, data } = await execute(true);
  if (!ok && status === 400 && data?.error?.message && data.error.message.includes('response_format')) {
    ({ ok, status, data } = await execute(false));
  }

  if (!ok) {
    throw new Error(`OpenAI chat error ${status}: ${data?.error?.message || JSON.stringify(data)}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenAI chat completion returned empty content');
  }

  return {
    text: content.trim(),
    raw: data,
  };
}

function buildMapPrompt(chunkEmails, chunkIndex, chunkTotal) {
  const hints = formatHintsForPrompt();
  const emailPayload = chunkEmails.map((email, idx) => ({
    ordinal: idx + 1,
    message_id: email.id,
    subject: email.subject,
    from: email.from.map((f) => f.display || f.email || '').filter(Boolean).join(', '),
    received_at_iso: email.received_at_iso,
    starred: email.starred || false,
    unread: email.unread || false,
    importance: email.importance || null,
    labels: email.labels || [],
    attachments: Array.isArray(email.attachments) ? email.attachments.length : 0,
    body_excerpt: email.body_excerpt,
  }));

  const instructions = [
    `You are assisting with triaging recent emails. This is chunk ${chunkIndex + 1} of ${chunkTotal}.`,
    'Evaluate each email for urgency and importance. Flag things like security issues, financial/billing problems, leadership requests, contracts/legal, deadlines, service disruptions, or meetings/tasks requiring a quick response.',
    'Use the provided hints when relevant but override them if the email content clearly contradicts them.',
    'Return JSON with shape: {"chunk_index": number, "evaluated_total": number, "top_candidates": [{"message_id": string, "priority_level": "critical" | "high" | "medium" | "low", "confidence": number (0-1), "reason": string, "signals": string[]}]}',
    'Include at most three candidates per chunk and omit low-priority marketing/noise unless the user explicitly needs them.',
    `Priority hints: ${hints}`,
    `Emails JSON:\n${JSON.stringify(emailPayload, null, 2)}`,
    'Respond ONLY with JSON.',
  ];

  return instructions.join('\n\n');
}

function buildReducePrompt(candidatePayload, totalMessages, chunkCount, mapFailures) {
  const instructions = [
    'You are consolidating prioritized email candidates from previous Map steps.',
    `Original email count: ${totalMessages}. Map chunks processed: ${chunkCount}. Failed chunks: ${mapFailures.length ? mapFailures.join(', ') : 'none'}.`,
    'Each candidate includes reasons gathered from earlier analysis. Compare them to finalize the top three highest priority emails that demand user attention.',
    'Prioritize clear urgent actions, deadlines, financial/security risks, leadership directives, or anything that could materially impact the user if ignored.',
    'Return JSON with shape: {"top_three": [{"rank": 1|2|3, "message_id": string, "priority_level": "critical"|"high"|"medium", "confidence": number (0-1), "summary": string, "recommended_action": string, "signals": string[]}], "backup_candidates": [... up to 3 similar objects ...], "validation": {"total_messages": number, "chunks_considered": number, "map_failures": number, "notes": string}}',
    'Use the validation block to state how the decision was made and any gaps or uncertainties.',
    `Candidates JSON:\n${JSON.stringify(candidatePayload, null, 2)}`,
    'Respond ONLY with JSON.',
  ];
  return instructions.join('\n\n');
}

async function runPriorityMapReduce(normalizedMessages) {
  const started = Date.now();
  const messagesById = new Map(normalizedMessages.map((m) => [m.id, m]));
  const chunks = chunkArray(normalizedMessages, PRIORITY_CHUNK_SIZE);
  const mapOutputs = [];
  const mapCandidates = new Map();
  const mapFailures = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const systemPrompt = 'You are a careful executive assistant helping triage email. Always respond with strict JSON matching the requested schema.';
    const userPrompt = buildMapPrompt(chunk, i, chunks.length);

    try {
      const result = await callChatCompletion({ systemPrompt, userPrompt, temperature: 0.2, maxTokens: 700 });
      const parsed = safeJsonParse(result.text);
      if (!parsed || !Array.isArray(parsed?.top_candidates)) {
        throw new Error('Map step returned invalid JSON');
      }

      const sanitized = {
        chunk_index: Number.isFinite(parsed.chunk_index) ? parsed.chunk_index : i,
        evaluated_total: Number.isFinite(parsed.evaluated_total) ? parsed.evaluated_total : chunk.length,
        top_candidates: parsed.top_candidates
          .map((candidate) => ({
            message_id: candidate?.message_id ? String(candidate.message_id) : null,
            priority_level: typeof candidate?.priority_level === 'string' ? candidate.priority_level : null,
            confidence: Number.isFinite(candidate?.confidence) ? candidate.confidence : null,
            reason: typeof candidate?.reason === 'string' ? candidate.reason : '',
            signals: Array.isArray(candidate?.signals) ? candidate.signals.map((s) => String(s)) : [],
          }))
          .filter((c) => c.message_id),
        raw_response: result.text,
      };

      mapOutputs.push(sanitized);

      for (const candidate of sanitized.top_candidates) {
        if (!candidate.message_id) continue;
        const meta = messagesById.get(candidate.message_id);
        if (!meta) continue;
        if (!mapCandidates.has(candidate.message_id)) {
          mapCandidates.set(candidate.message_id, {
            message: meta,
            occurrences: 0,
            max_confidence: 0,
            priority_levels: new Set(),
            reasons: [],
            signals: new Set(),
          });
        }
        const record = mapCandidates.get(candidate.message_id);
        record.occurrences += 1;
        if (typeof candidate.confidence === 'number' && candidate.confidence > record.max_confidence) {
          record.max_confidence = candidate.confidence;
        }
        if (candidate.priority_level) record.priority_levels.add(candidate.priority_level.toLowerCase());
        if (candidate.reason) record.reasons.push(candidate.reason);
        for (const signal of candidate.signals || []) record.signals.add(String(signal));
      }
    } catch (error) {
      mapFailures.push({ chunk: i + 1, error: String(error) });
      mapOutputs.push({
        chunk_index: i,
        evaluated_total: chunk.length,
        top_candidates: [],
        error: String(error),
      });
    }
  }

  const aggregatedCandidates = Array.from(mapCandidates.values())
    .map((entry) => ({
      message_id: entry.message.id,
      subject: entry.message.subject,
      from: entry.message.from.map((f) => f.display || f.email || '').filter(Boolean).join(', '),
      received_at_iso: entry.message.received_at_iso,
      occurrences: entry.occurrences,
      max_confidence: Number(entry.max_confidence.toFixed(3)),
      priority_levels: Array.from(entry.priority_levels),
      combined_reason: entry.reasons.join(' '),
      signals: Array.from(entry.signals),
    }))
    .sort((a, b) => {
      if (b.max_confidence !== a.max_confidence) return b.max_confidence - a.max_confidence;
      if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
      return (a.subject || '').localeCompare(b.subject || '');
    })
    .slice(0, PRIORITY_MAX_CANDIDATES);

  if (!aggregatedCandidates.length) {
    return {
      status: 'no_candidates',
      model: PRIORITY_MODEL,
      chunk_size: PRIORITY_CHUNK_SIZE,
      map_chunks: mapOutputs,
      map_failures,
      reduce: null,
      top_emails: [],
      duration_ms: Date.now() - started,
    };
  }

  const reduceSystemPrompt = 'You are a precise executive assistant finalizing the top-priority emails from prior analysis. Output must be valid JSON.';
  const reduceUserPrompt = buildReducePrompt(
    aggregatedCandidates,
    normalizedMessages.length,
    chunks.length,
    mapFailures.map((m) => `chunk ${m.chunk}`),
  );

  let reduceParsed = null;
  try {
    const reduceResult = await callChatCompletion({ systemPrompt: reduceSystemPrompt, userPrompt: reduceUserPrompt, temperature: 0.1, maxTokens: 600 });
    reduceParsed = safeJsonParse(reduceResult.text);
    if (!reduceParsed || !Array.isArray(reduceParsed?.top_three)) {
      throw new Error('Reduce step returned invalid JSON');
    }
  } catch (error) {
    return {
      status: 'reduce_failed',
      model: PRIORITY_MODEL,
      chunk_size: PRIORITY_CHUNK_SIZE,
      map_chunks: mapOutputs,
      map_failures,
      reduce: { error: String(error) },
      top_emails: [],
      duration_ms: Date.now() - started,
    };
  }

  const topEmails = (reduceParsed.top_three || [])
    .filter((item) => item?.message_id)
    .map((item) => ({
      rank: Number.isFinite(item.rank) ? item.rank : null,
      message_id: String(item.message_id),
      priority_level: typeof item.priority_level === 'string' ? item.priority_level : null,
      confidence: Number.isFinite(item.confidence) ? item.confidence : null,
      summary: typeof item.summary === 'string' ? item.summary : '',
      recommended_action: typeof item.recommended_action === 'string' ? item.recommended_action : '',
      signals: Array.isArray(item.signals) ? item.signals : [],
    }));

  return {
    status: 'ok',
    model: PRIORITY_MODEL,
    chunk_size: PRIORITY_CHUNK_SIZE,
    map_chunks: mapOutputs,
    map_failures,
    reduce: reduceParsed,
    top_emails: topEmails,
    duration_ms: Date.now() - started,
  };
}

async function buildRecentPriorityBundle({ grantId, requestedLimit = 50, includeBodies = true }) {
  if (!grantId) throw new Error('Missing grantId');

  const numericRequested = Number(requestedLimit);
  const requested = Number.isFinite(numericRequested) && numericRequested > 0 ? numericRequested : 50;
  const limit = Math.min(Math.max(requested, 1), 200);

  const nylasPage = await listMessagesPage({
    grantId,
    limit,
    view: includeBodies ? 'expanded' : undefined,
  });

  const rawMessages = Array.isArray(nylasPage?.data)
    ? nylasPage.data
    : (Array.isArray(nylasPage?.messages) ? nylasPage.messages : []);

  const sortedMessages = rawMessages
    .map((message) => ({
      message,
      received: toEpochSeconds(message?.received_at ?? message?.date ?? 0) || 0,
    }))
    .sort((a, b) => b.received - a.received)
    .map((entry) => entry.message)
    .slice(0, limit);

  const normalized = sortedMessages.map((message, index) => {
    const id = message?.id ? String(message.id) : `message-${index + 1}`;
    const threadId = message?.thread_id ? String(message.thread_id) : undefined;
    const receivedEpoch = toEpochSeconds(message?.received_at ?? message?.date ?? 0);
    const receivedIso = toIsoFromEpoch(receivedEpoch);
    const from = normalizeAddressList(message?.from);
    const to = normalizeAddressList(message?.to);
    const cc = normalizeAddressList(message?.cc);
    const bcc = normalizeAddressList(message?.bcc);
    const replyTo = normalizeAddressList(message?.reply_to);
    const labels = Array.isArray(message?.labels)
      ? message.labels
          .map((label) => {
            if (!label) return null;
            if (typeof label === 'string') return label;
            return label.display_name || label.name || label.id || null;
          })
          .filter(Boolean)
      : [];
    const folder =
      (message?.folder && (message.folder.display_name || message.folder.name || message.folder.id)) ||
      undefined;
    const importance =
      (typeof message?.importance === 'string' && message.importance) ||
      (message?.headers?.Importance ??
        message?.headers?.importance ??
        message?.header_map?.Importance ??
        message?.header_map?.importance);
    const hasAttachments =
      (Array.isArray(message?.files) && message.files.length > 0) ||
      (Array.isArray(message?.attachments) && message.attachments.length > 0);
    const attachmentsSource = Array.isArray(message?.files)
      ? message.files
      : Array.isArray(message?.attachments)
        ? message.attachments
        : [];
    const attachments = attachmentsSource.map((file) => ({
      id: file?.id ? String(file.id) : undefined,
      filename: file?.filename || file?.display_name || undefined,
      content_type: file?.content_type || file?.contentType || file?.type || undefined,
      size: typeof file?.size === 'number' ? file.size : undefined,
    }));
    const snippet = typeof message?.snippet === 'string' ? message.snippet : '';
    const rawBody = includeBodies ? extractPlainText(message) : '';
    const bodyExcerptSource = rawBody || snippet || '';
    const bodyExcerpt = bodyExcerptSource ? bodyExcerptSource.slice(0, PRIORITY_MAX_BODY_CHARS) : '';
    const preview = bodyExcerpt || snippet;

    return {
      id,
      thread_id: threadId,
      subject: message?.subject || '',
      snippet,
      body_text: bodyExcerpt,
      body_excerpt: bodyExcerpt,
      body_preview: preview ? preview.slice(0, 400) : '',
      unread: message?.unread ?? message?.is_unread ?? false,
      starred: message?.starred ?? message?.flagged ?? message?.is_starred ?? false,
      importance: typeof importance === 'string' ? importance : undefined,
      from,
      to,
      cc,
      bcc,
      reply_to: replyTo,
      labels,
      folder,
      has_attachments: hasAttachments,
      attachments,
      received_at: receivedEpoch,
      received_at_iso: receivedIso,
      size: typeof message?.size === 'number' ? message.size : undefined,
      raw: message,
    };
  });

  const mapReduce = await runPriorityMapReduce(normalized);

  return {
    source: 'nylas',
    grantId,
    requested_limit: requested,
    returned: normalized.length,
    total_available: typeof nylasPage?.total === 'number' ? nylasPage.total : undefined,
    next_cursor: nylasPage?.next_cursor ?? nylasPage?.next_page_token ?? null,
    generated_at: new Date().toISOString(),
    messages: normalized,
    map_reduce: mapReduce,
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry ?? '').trim()))
    .filter(Boolean);
}

function computeTopSenders(messages, max = 3) {
  const counts = new Map();
  for (const message of messages || []) {
    if (!message) continue;
    const primary = Array.isArray(message.from) ? message.from[0] : null;
    const sender =
      (primary && (primary.display || primary.email || primary.name)) ||
      (typeof message.from === 'string' ? message.from : null);
    if (!sender) continue;
    if (!counts.has(sender)) counts.set(sender, { sender, count: 0 });
    counts.get(sender).count += 1;
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(1, max));
}

function formatValidation(validation) {
  if (!validation) return '';
  if (typeof validation === 'string') return validation.trim();
  if (typeof validation !== 'object') return '';

  const total = Number(validation.total_messages);
  const chunks = Number(validation.chunks_considered ?? validation.chunks);
  const failures = Number(
    validation.map_failures ??
      validation.failures ??
      (Array.isArray(validation.failed_chunks) ? validation.failed_chunks.length : null),
  );
  const notes = typeof validation.notes === 'string' ? validation.notes.trim() : '';

  const parts = [];
  if (Number.isFinite(total) && total >= 0) parts.push(`${total} message${total === 1 ? '' : 's'} evaluated`);
  if (Number.isFinite(chunks) && chunks >= 0) parts.push(`${chunks} chunk${chunks === 1 ? '' : 's'}`);
  if (Number.isFinite(failures) && failures >= 0) parts.push(`${failures} failure${failures === 1 ? '' : 's'}`);

  const joined = parts.length ? parts.join(', ') : '';
  if (joined && notes) return `${joined}. ${notes}`;
  return notes || joined;
}

async function generateTriageSummary(bundle) {
  const messages = Array.isArray(bundle?.messages) ? bundle.messages : [];
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const mapReduce = bundle?.map_reduce || {};
  const topEmailsRaw = Array.isArray(mapReduce.top_emails) ? mapReduce.top_emails : [];
  const backupRaw = Array.isArray(mapReduce?.reduce?.backup_candidates)
    ? mapReduce.reduce.backup_candidates
    : [];
  const validationRaw =
    mapReduce?.reduce?.validation ?? mapReduce?.validation ?? mapReduce?.reduce?.validation ?? null;

  const topEmails = topEmailsRaw.map((entry) => {
    const meta = entry?.message_id ? messageById.get(entry.message_id) : null;
    const from = meta?.from?.map((f) => f.display || f.email || '').filter(Boolean).join(', ') || null;
    return {
      rank: Number.isFinite(entry?.rank) ? entry.rank : null,
      message_id: entry?.message_id ? String(entry.message_id) : null,
      priority_level: typeof entry?.priority_level === 'string' ? entry.priority_level : null,
      confidence: Number.isFinite(entry?.confidence) ? entry.confidence : null,
      summary: typeof entry?.summary === 'string' ? entry.summary : '',
      recommended_action: typeof entry?.recommended_action === 'string' ? entry.recommended_action : '',
      signals: Array.isArray(entry?.signals) ? entry.signals : [],
      subject: meta?.subject || null,
      from,
      received_at_iso: meta?.received_at_iso || null,
      unread: typeof meta?.unread === 'boolean' ? meta.unread : null,
      starred: typeof meta?.starred === 'boolean' ? meta.starred : null,
      importance: meta?.importance || null,
    };
  });

  const backupCandidates = backupRaw.map((entry) => {
    const meta = entry?.message_id ? messageById.get(entry.message_id) : null;
    const from = meta?.from?.map((f) => f.display || f.email || '').filter(Boolean).join(', ') || null;
    return {
      rank: Number.isFinite(entry?.rank) ? entry.rank : null,
      message_id: entry?.message_id ? String(entry.message_id) : null,
      priority_level: typeof entry?.priority_level === 'string' ? entry.priority_level : null,
      confidence: Number.isFinite(entry?.confidence) ? entry.confidence : null,
      summary: typeof entry?.summary === 'string' ? entry.summary : '',
      recommended_action: typeof entry?.recommended_action === 'string' ? entry.recommended_action : '',
      signals: Array.isArray(entry?.signals) ? entry.signals : [],
      subject: meta?.subject || null,
      from,
      received_at_iso: meta?.received_at_iso || null,
    };
  });

  const topSenders = computeTopSenders(messages, 5);
  const summaryContext = {
    generated_at: bundle?.generated_at ?? null,
    total_recent: bundle?.returned ?? messages.length,
    total_available: bundle?.total_available ?? null,
    map_reduce_status: mapReduce?.status ?? 'unknown',
    urgent_candidates: topEmails.slice(0, 5),
    backup_candidates: backupCandidates.slice(0, 5),
    map_failures: Array.isArray(mapReduce?.map_failures)
      ? mapReduce.map_failures.map((failure) => ({
          chunk: failure?.chunk ?? null,
          error: failure?.error ? String(failure.error).slice(0, 140) : null,
        }))
      : [],
    validation: validationRaw,
    top_senders: topSenders,
  };

  const systemPrompt = [
    'You are a senior email operations specialist summarizing prioritized inbox results for an executive user.',
    'Only use the data provided in the JSON payload.',
    'Respond with valid JSON that matches the following schema:',
    '{',
    '  "narrative": string,',
    '  "highlights": string[],',
    '  "recommended_actions": string[],',
    '  "metrics": {',
    '    "total_recent": number,',
    '    "total_available": number | null,',
    '    "urgent_count": number,',
    '    "map_reduce_status": string,',
    '    "generated_at": string | null,',
    '    "top_senders": string[]',
    '  },',
    '  "validation": string',
    '}',
    'Keep outputs concise and grounded. Do not fabricate emails or people.',
  ].join('\n');

  const userPrompt = [
    'Recent email triage results (JSON):',
    JSON.stringify(summaryContext, null, 2),
    'Respond ONLY with JSON matching the schema.',
  ].join('\n\n');

  let modelResponse = '';
  let parsed = null;
  try {
    const completion = await callChatCompletion({
      systemPrompt,
      userPrompt,
      temperature: 0.2,
      maxTokens: 600,
    });
    modelResponse = completion.text || '';
    parsed = safeJsonParse(modelResponse);
  } catch (error) {
    console.warn?.('[triage] summary generation failed, falling back to heuristic narrative', error);
  }

  const fallbackHighlights = topEmails
    .slice(0, 3)
    .map((entry) => {
      const subject = entry.subject || 'Untitled message';
      const from = entry.from || 'unknown sender';
      const summary = entry.summary || entry.recommended_action || '';
      return `${subject} - ${from}${summary ? ` (${summary})` : ''}`;
    })
    .filter(Boolean);

  const fallbackActions = topEmails
    .map((entry) => {
      if (entry.recommended_action) return entry.recommended_action;
      const subject = entry.subject || 'message';
      const from = entry.from || 'sender';
      return `Review "${subject}" from ${from}.`;
    })
    .filter(Boolean);

  const fallbackNarrative = topEmails.length
    ? `Top priorities: ${topEmails
        .slice(0, 3)
        .map((entry, index) => {
          const subject = entry.subject || 'Untitled';
          const from = entry.from || 'unknown sender';
          const priority = entry.priority_level || 'priority';
          return `#${entry.rank || index + 1} "${subject}" from ${from} (${priority}).`;
        })
        .join(' ')}`
    : mapReduce?.status === 'ok'
      ? 'No high-priority emails surfaced by the triage model.'
      : `Triage pipeline reported status "${mapReduce?.status || 'unknown'}". No prioritized emails available.`;

  const metrics = parsed && typeof parsed.metrics === 'object' ? { ...parsed.metrics } : {};
  if (!Number.isFinite(metrics.total_recent)) {
    metrics.total_recent = bundle?.returned ?? messages.length ?? 0;
  }
  if (typeof metrics.total_available === 'undefined' && bundle?.total_available != null) {
    metrics.total_available = bundle.total_available;
  }
  if (!Number.isFinite(metrics.urgent_count)) {
    metrics.urgent_count = topEmails.length;
  }
  if (!metrics.map_reduce_status) {
    metrics.map_reduce_status = mapReduce?.status ?? 'unknown';
  }
  if (!('generated_at' in metrics)) {
    metrics.generated_at = bundle?.generated_at ?? null;
  }
  if (!Array.isArray(metrics.top_senders) || !metrics.top_senders.length) {
    metrics.top_senders = topSenders.map((entry) => entry.sender);
  } else {
    metrics.top_senders = normalizeStringArray(metrics.top_senders);
  }

  const summary = {
    model: PRIORITY_MODEL,
    status: parsed && typeof parsed === 'object' ? 'ok' : 'fallback',
    narrative:
      parsed && typeof parsed?.narrative === 'string' && parsed.narrative.trim()
        ? parsed.narrative.trim()
        : fallbackNarrative,
    highlights:
      parsed && normalizeStringArray(parsed.highlights).length
        ? normalizeStringArray(parsed.highlights)
        : fallbackHighlights,
    recommended_actions:
      parsed && normalizeStringArray(parsed.recommended_actions).length
        ? normalizeStringArray(parsed.recommended_actions)
        : fallbackActions,
    metrics,
    validation:
      parsed && typeof parsed?.validation === 'string' && parsed.validation.trim()
        ? parsed.validation.trim()
        : formatValidation(validationRaw),
    raw_model_response: modelResponse || null,
    structured: parsed && typeof parsed === 'object' ? parsed : null,
  };

  if (!summary.validation && Array.isArray(mapReduce?.map_failures) && mapReduce.map_failures.length) {
    const failures = mapReduce.map_failures
      .map((failure) => `chunk ${failure?.chunk || '?'} error: ${String(failure?.error || '').slice(0, 120)}`)
      .join('; ');
    summary.validation = failures;
  }

  return summary;
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/realtime/session') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing OPENAI_API_KEY on server' }));
      return;
    }

    let body = {};
    try {
      body = await readJson(req);
    } catch {
      // ignore bad JSON; use defaults
    }

    const requestedModel = body?.model || 'gpt-realtime';

    try {
      // GA endpoint (/v1/realtime/client_secrets) - only accepts type and model
      // Voice, modalities, and transcription are configured in the session itself
      const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session: {
            type: 'realtime',
            model: requestedModel,
          },
        }),
      });

      const ct = response.headers.get('content-type') || '';
      if (response.ok) {
        const payload = ct.includes('application/json') ? await response.json() : { value: await response.text() };
        // GA endpoint returns { value: "ek_..." } at top level
        // Normalize to { client_secret: { value: "ek_..." } } for SDK compatibility
        const normalized = payload.value ? { client_secret: { value: payload.value } } : payload;
        console.log('[realtime/session] Success for model', requestedModel, '- returning:', JSON.stringify(normalized).substring(0, 200));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(normalized));
        return;
      }

      const body1 = await response.text();
      console.error(`[realtime/session] Upstream ${response.status} for model ${requestedModel}:`, body1);
      res.writeHead(response.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'OpenAI realtime session create error', status: response.status, body: body1 }));
    } catch (e) {
      console.error('[realtime/session error]', e);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/email/index') {
    try {
      const body = await readJson(req);
      const items = Array.isArray(body?.items) ? body.items : [];
      const namespace = body?.namespace || '';
      const records = [];
      for (const item of items) {
        const id = String(item.id || crypto.randomUUID());
        const subject = item.subject || '';
        const text = item.body_text || stripHtml(item.body_html || '');
        const chunks = chunkText(text);
        const embeddings = await embedTexts(chunks);
        for (let i = 0; i < embeddings.length; i++) {
          records.push({
            id: `${id}#${i}`,
            values: embeddings[i],
            metadata: {
              email_id: id,
              thread_id: item.thread_id || null,
              subject,
              from: item.from || null,
              date: item.date || null,
              snippet: chunks[i]?.slice(0, 200) || '',
            },
          });
        }
      }
      if (records.length) await upsertVectors(records, namespace);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ upserted: records.length }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/email/search') {
    let body = {};
    try {
      body = await readJson(req);
    } catch {}
    const text = body?.queries?.[0]?.text || '';
    const topK = Number(body?.top_k || 10);
    const namespace = body?.namespace || process.env.NYLAS_GRANT_ID || '';


    const pineconeReady = !!(process.env.PINECONE_API_KEY && process.env.PINECONE_INDEX_HOST);

    if (!pineconeReady) {
      // Fallback stub
      const results = [
        { type: 'email', id: 'example-1', thread_id: 't-1', title: 'Welcome to your Voice Agent', snippet: `Sample result for: ${text}`, from: 'agent@example.com', date: Math.floor(Date.now() / 1000) },
      ];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ results, total: 1, note: 'Pinecone not configured; returning stub results.' }));
      return;
    }

    try {
      const [embedding] = await embedTexts([text]);
      const rawFilter = body?.filters || undefined;
      const filter = rawFilter && typeof rawFilter === 'object' ? { ...rawFilter } : {};
      // Default to message vectors unless caller overrides
      if (filter && typeof filter === 'object' && !('type' in filter)) {
        filter.type = { $eq: 'message' };
      }
      // Query with larger topK to get total count
      const q = await queryTopK(embedding, Math.max(topK, 100), namespace, true, filter);
      const allMatches = q?.matches || [];
      const total = allMatches.length;

      // Return top 10 with full metadata
      const results = allMatches.slice(0, 10).map((m) => ({
        type: 'email',
        id: m?.metadata?.email_id || m?.id,
        thread_id: m?.metadata?.thread_id || null,
        title: m?.metadata?.subject || m?.id,
        snippet: m?.metadata?.snippet || '',
        from: m?.metadata?.from || '',
        to: m?.metadata?.to || '',
        date: m?.metadata?.date || (m?.metadata?.date_created ? Math.floor(new Date(m?.metadata?.date_created).getTime() / 1000) : Math.floor(Date.now() / 1000)),
        score: m?.score,
      }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ results, total }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // POST /email/aggregate (demo: counts and simple group-by using a filtered topK sample)
  if (req.method === 'POST' && url.pathname === '/email/aggregate') {
    try {
      const body = await readJson(req);
      const metric = body?.metric || 'count';
      const groupBy = Array.isArray(body?.group_by) ? body.group_by : [];
      const namespace = body?.namespace || process.env.NYLAS_GRANT_ID || '';
      const rawFilter = body?.filters || undefined;
      const filter = rawFilter && typeof rawFilter === 'object' ? { ...rawFilter } : {};
      if (filter && typeof filter === 'object' && !('type' in filter)) {
        filter.type = { $eq: 'message' };
      }
      const topK = Math.min(Number(body?.top_k || 200), 1000);

      // Use a neutral embedding and rely on filter + topK sample
      const [embedding] = await embedTexts(['aggregate']);
      const q = await queryTopK(embedding, topK, namespace, true, filter);
      const matches = Array.isArray(q?.matches) ? q.matches : [];

      const total = matches.length;
      let groups = [];
      if (groupBy.length) {
        const map = new Map();
        for (const m of matches) {
          const keyObj = {};
          for (const k of groupBy) {
            if (k === 'from_domain') {
              const from = String(m?.metadata?.from || '');
              const domain = from.includes('@') ? from.split('@').pop() : from;
              keyObj[k] = domain || '';
            } else if (k in (m?.metadata || {})) {
              keyObj[k] = String(m.metadata[k]);
            } else {
              keyObj[k] = '';
            }
          }
          const keyStr = JSON.stringify(keyObj);
          map.set(keyStr, (map.get(keyStr) || 0) + 1);
        }
        groups = Array.from(map.entries()).map(([key, count]) => ({ key: JSON.parse(key), count }));
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ total, groups }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }
  // POST /email/count (count message vectors via query with large top_k)
  if (req.method === 'POST' && url.pathname === '/email/count') {
    try {
      const body = await readJson(req);
      const envNamespace = process.env.NYLAS_GRANT_ID || undefined;
      const namespace = typeof body?.namespace === 'string' && body.namespace.trim()
        ? body.namespace.trim()
        : envNamespace;
      const rawFilter = body?.filters || undefined;
      const filter = rawFilter && typeof rawFilter === 'object' ? { ...rawFilter } : {};
      if (filter && typeof filter === 'object' && !('type' in filter)) {
        filter.type = { $eq: 'message' };
      }

      let total = null;
      try {
        const stats = await describeIndexStats({ namespace, filter });
        if (stats && typeof stats === 'object') {
          const namespaces = stats.namespaces && typeof stats.namespaces === 'object' ? stats.namespaces : undefined;
          if (namespace && namespaces && namespace in namespaces) {
            const nsStats = namespaces[namespace];
            if (nsStats && typeof nsStats.vectorCount === 'number') {
              total = nsStats.vectorCount;
            }
          } else if (!namespace && namespaces) {
            total = Object.values(namespaces).reduce((sum, ns) => {
              const count = ns && typeof ns.vectorCount === 'number' ? ns.vectorCount : 0;
              return sum + count;
            }, 0);
          }
          if (total === null && typeof stats.totalVectorCount === 'number') {
            total = stats.totalVectorCount;
          }
        }
      } catch (err) {
        console.warn('[email/count] describeIndexStats fallback', err);
      }

      if (total === null) {
        const dummyVector = new Array(1536).fill(0.1);
        const results = await queryTopK(dummyVector, 10000, namespace ?? '', false, filter);
        total = Array.isArray(results?.matches) ? results.matches.length : 0;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ total: Number(total) || 0 }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // POST /email/analyze (summarize topK results using OpenAI)
  if (req.method === 'POST' && url.pathname === '/email/analyze') {
    try {
      const body = await readJson(req);
      const text = String(body?.text || '');
      const topK = Math.min(Number(body?.top_k || 10), 50);
      const namespace = body?.namespace || process.env.NYLAS_GRANT_ID || '';
      const rawFilter = body?.filters || undefined;
      const filter = rawFilter && typeof rawFilter === 'object' ? { ...rawFilter } : {};
      if (filter && typeof filter === 'object' && !('type' in filter)) {
        filter.type = { $eq: 'message' };
      }

      if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
      const [embedding] = await embedTexts([text || 'summarize emails']);
      const q = await queryTopK(embedding, topK, namespace, true, filter);
      const matches = Array.isArray(q?.matches) ? q.matches : [];
      const lines = matches.map((m, i) => `- ${i + 1}. ${String(m?.metadata?.subject || m?.id)} :: score=${m?.score ?? ''}`);

      const prompt = [
        'Summarize the following retrieved emails into:',
        '1) 3-7 actionable bullets',
        '2) One executive paragraph',
        '3) Up to 8 tags',
        '',
        'Results:',
        lines.join('\n'),
      ].join('\n');

      const r = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'gpt-5-mini', input: prompt }),
      });
      const json = await r.json();
      let summary = '';
      if (json?.output_text) {
        summary = json.output_text;
      } else if (Array.isArray(json?.output)) {
        const parts = [];
        for (const out of json.output) {
          for (const c of out?.content || []) {
            if (typeof c?.text === 'string') parts.push(c.text);
          }
        }
        summary = parts.join('\n').trim();
      } else if (Array.isArray(json?.content)) {
        const parts = [];
        for (const c of json.content) {
          if (typeof c?.text === 'string') parts.push(c.text);
        }
        summary = parts.join('\n').trim();
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ summary, count: matches.length }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }


  // Nylas proxy endpoints
  if (req.method === 'GET' && url.pathname === '/nylas/contacts') {
    try {
      const grantId = url.searchParams.get('grantId') || process.env.NYLAS_GRANT_ID;
      const limit = Number(url.searchParams.get('limit') || '5');
      if (!grantId) throw new Error('Missing grantId');
      const data = await listContacts({ grantId, limit });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/nylas/events') {
    try {
      const grantId = url.searchParams.get('grantId') || process.env.NYLAS_GRANT_ID;
      const limit = Number(url.searchParams.get('limit') || '5');
      const calendarId = url.searchParams.get('calendar_id') || 'primary';
      if (!grantId) throw new Error('Missing grantId');
      const data = await listEvents({ grantId, calendarId, limit });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/nylas/unread') {
    try {
      const grantId = url.searchParams.get('grantId') || process.env.NYLAS_GRANT_ID;
      const limit = Number(url.searchParams.get('limit') || '5');
      const sinceEpoch = url.searchParams.get('sinceEpoch');
      if (!grantId) throw new Error('Missing grantId');
      const received_after = sinceEpoch ? Number(sinceEpoch) : undefined;
      const raw = await listUnreadMessages({ grantId, limit, received_after: received_after || undefined });
      const items = Array.isArray(raw?.data) ? raw.data : (Array.isArray(raw?.messages) ? raw.messages : []);
      const normalized = items.map((m) => {
        const rawFrom = Array.isArray(m?.from) ? m.from : (m?.from ? [m.from] : []);
        const primary = rawFrom[0] || {};
        const fromEmail = String(primary?.email || primary?.address || '').trim();
        const fromName = String(primary?.name || primary?.display_name || '').trim();
        const fromDisplay = fromEmail && fromName ? `${fromName} <${fromEmail}>` : (fromName || fromEmail || '');
        const receivedRaw = Number(m?.received_at ?? m?.date ?? 0);
        const receivedMs = Number.isFinite(receivedRaw) && receivedRaw > 0
          ? (receivedRaw > 1e12 ? receivedRaw : receivedRaw * 1000)
          : null;
        const receivedIso = receivedMs ? new Date(receivedMs).toISOString() : null;
        const receivedEpoch = receivedMs ? Math.floor(receivedMs / 1000) : null;
        return {
          id: m?.id ? String(m.id) : undefined,
          thread_id: m?.thread_id ? String(m.thread_id) : undefined,
          subject: m?.subject || '',
          snippet: m?.snippet || '',
          unread: m?.unread ?? true,
          received_at: receivedEpoch,
          received_at_iso: receivedIso,
          from: {
            email: fromEmail || undefined,
            name: fromName || undefined,
            display: fromDisplay || undefined,
          },
          raw: m,
        };
      });
      const total = typeof raw?.total === 'number'
        ? raw.total
        : typeof raw?.count === 'number'
          ? raw.count
          : normalized.length;
      const nextCursor = raw?.next_cursor ?? raw?.next_page_token ?? raw?.nextPageToken ?? null;
      const payload = {
        total,
        has_more: Boolean(nextCursor),
        next_cursor: nextCursor,
        messages: normalized,
        data: normalized,
        source: 'nylas',
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }


  if (req.method === 'GET' && url.pathname === '/nylas/messages/recent') {
    try {
      const grantId = url.searchParams.get('grantId') || process.env.NYLAS_GRANT_ID;
      const requestedLimit = Number(url.searchParams.get('limit') || '50');
      const includeBodiesParam = url.searchParams.get('includeBodies');
      const includeBodies = includeBodiesParam ? includeBodiesParam.toLowerCase() === 'true' : true;
      if (!grantId) throw new Error('Missing grantId');

      const responsePayload = await buildRecentPriorityBundle({
        grantId,
        requestedLimit,
        includeBodies,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(responsePayload));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/email/triage') {
    try {
      const body = await readJson(req);
      const grantId =
        body?.grantId ||
        body?.grant_id ||
        url.searchParams.get('grantId') ||
        process.env.NYLAS_GRANT_ID;
      const requestedLimit =
        typeof body?.limit === 'number' ? body.limit : Number(body?.requested_limit ?? body?.limit ?? 50);
      const includeBodies =
        typeof body?.includeBodies === 'boolean'
          ? body.includeBodies
          : typeof body?.include_bodies === 'boolean'
            ? body.include_bodies
            : true;
      if (!grantId) throw new Error('Missing grantId');

      const started = Date.now();
      const bundle = await buildRecentPriorityBundle({
        grantId,
        requestedLimit,
        includeBodies,
      });
      const summary = await generateTriageSummary(bundle);
      const payload = {
        ...bundle,
        triage_summary: {
          ...summary,
          duration_ms: Date.now() - started,
        },
      };

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }


  if (req.method === 'POST' && (url.pathname === '/api/sync/backfill' || url.pathname === '/sync/backfill')) {
    try {
      const body = await readJson(req);
      const grantId = body?.grantId || process.env.NYLAS_GRANT_ID;
      const deltaWindow = 10000;
      const max = Math.min(Math.max(Number(body?.max || deltaWindow), 1), deltaWindow); // clamp to latest 10k
      const months = Math.min(Number(body?.months || 240), 240);
      if (!grantId) throw new Error('Missing grantId');

      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      start.setUTCMonth(start.getUTCMonth() - months);
      const received_after = Math.floor(start.getTime() / 1000);

      let upserted = 0;
      let pages = 0;
      let page_token = undefined;
      const started = Date.now();

      while (upserted < max) {
        const page = await listMessagesPage({ grantId, limit: 200, page_token, received_after });
        const msgs = Array.isArray(page?.data) ? page.data : (Array.isArray(page?.messages) ? page.messages : []);
        if (!msgs.length) break;

        const remaining = max - upserted;
        const batchMsgs = msgs.slice(0, remaining);
        const records = [];
        const allChunks = [];
        const chunkMap = [];
        let msgsWithChunks = 0;

        for (const m of batchMsgs) {
          const id = String(m?.id || crypto.randomUUID());
          const subject = String(m?.subject || '');
          const from = (Array.isArray(m?.from) ? (m.from[0]?.email || m.from[0]?.address || '') : (m?.from?.email || m?.from?.address || '')) || null;
          const date = Number(m?.received_at || m?.date || 0) || null;
          const body_text = String(m?.snippet || '') || '';
          const text = body_text || '';
          if (!text) continue;

          const chunks = chunkText(text);
          if (chunks.length) msgsWithChunks += 1;
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            allChunks.push(chunk);
            chunkMap.push({ id, chunkIndex: i, thread_id: m?.thread_id || null, subject, from, date, snippet: chunk.slice(0, 200) || '' });
          }
        }

        if (allChunks.length) {
          const embeddings = await embedTexts(allChunks);
          for (let j = 0; j < embeddings.length; j++) {
            const mp = chunkMap[j];
            records.push({
              id: `${mp.id}#${mp.chunkIndex}`,
              values: embeddings[j],
              metadata: {
                type: 'message',
                email_id: mp.id,
                thread_id: mp.thread_id,
                subject: mp.subject,
                from: mp.from,
                date: mp.date,
                snippet: mp.snippet,
              },
            });
          }
          await upsertVectors(records, grantId);
          upserted += msgsWithChunks;
        }

        pages += 1;
        page_token = page?.next_cursor || page?.next_page_token || undefined;
        if (!page_token) break;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, grantId, upserted, pages, tookMs: Date.now() - started, since: received_after }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/sync/start') {
    try {
      const body = await readJson(req);
      const grantId = body?.grantId || process.env.NYLAS_GRANT_ID;
      const limit = Number(body?.limit || 25);
      const sinceEpoch = body?.sinceEpoch;
      if (!grantId) throw new Error('Missing grantId');
      const unread = await listUnreadMessages({ grantId, limit, received_after: sinceEpoch || undefined });
      const items = Array.isArray(unread?.data) ? unread.data : (Array.isArray(unread?.messages) ? unread.messages : []);
      const queued = items.length;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, queued, preview: items.slice(0, 5) }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }



  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
