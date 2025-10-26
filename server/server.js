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
      const namespace = body?.namespace || process.env.NYLAS_GRANT_ID || '';
      const rawFilter = body?.filters || undefined;
      const filter = rawFilter && typeof rawFilter === 'object' ? { ...rawFilter } : {};
      if (filter && typeof filter === 'object' && !('type' in filter)) {
        filter.type = { $eq: 'message' };
      }
      // Query with a dummy vector to get count (Pinecone returns top_k results)
      // Use max top_k (10000) to approximate total count
      const dummyVector = new Array(1536).fill(0.1);
      const results = await queryTopK(dummyVector, 10000, namespace, true, filter);
      const total = results?.matches?.length || 0;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ total }));
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
      const data = await listUnreadMessages({ grantId, limit, received_after: sinceEpoch || undefined });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
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
      const max = Math.min(Number(body?.max || 1000), 100000);  // Increased from 5000 to 100000
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

