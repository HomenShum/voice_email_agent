// Lightweight local runner to expose compiled Azure Functions handlers as HTTP endpoints
// - Uses a stub of @azure/functions in apps/functions/dist/node_modules to capture handlers
// - Serves /api/search and /api/aggregate on http://localhost:7071

const http = require('http');
const path = require('path');
require('dotenv').config();

// Ensure required env defaults
process.env.PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'emails';
process.env.OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-5-mini';
process.env.OPENAI_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';

// Load compiled function modules first; they will import the stub and register handlers
require(path.resolve('apps/functions/dist/functions/agent.js'));
require(path.resolve('apps/functions/dist/functions/search.js'));
require(path.resolve('apps/functions/dist/functions/aggregate.js'));
require(path.resolve('apps/functions/dist/functions/mcp.js'));


// Handlers were captured by the stub on globalThis
const handlers = (globalThis.__handlers) || {};
console.log('Handlers registered:', Object.keys(handlers));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      if (!data) return resolve({ raw: '', json: {} });
      try {
        resolve({ raw: data, json: JSON.parse(data) });
      } catch (e) {
        resolve({ raw: data, json: {} });
      }
    });
    req.on('error', reject);
  });
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

const server = http.createServer(async (req, res) => {
  try {
    // Handle CORS preflight for all API routes
    if (req.method === 'OPTIONS' && req.url.startsWith('/api/')) {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/api/agent') {
      if (!handlers.agent) throw new Error('agent handler not registered');
      const { json } = await readBody(req);
      const ctx = { log: console.log, error: console.error, warn: console.warn, info: console.log, invocationId: 'dev', functionName: 'agent' };
      const result = await handlers.agent({ json: async () => json, method: 'POST' }, ctx);
      const status = result?.status || 200;
      const headers = Object.assign({ 'content-type': 'text/event-stream' }, CORS_HEADERS, result?.headers || {});
      res.writeHead(status, headers);
      // For SSE streams, the body is a ReadableStream
      if (result?.body && typeof result.body.getReader === 'function') {
        const reader = result.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
        }
        res.end();
      } else {
        res.end(typeof result?.body === 'string' ? result.body : JSON.stringify(result?.jsonBody || {}));
      }
      return;
    }
    if (req.method === 'POST' && req.url === '/api/search') {
      if (!handlers.search) throw new Error('search handler not registered');
      const { json } = await readBody(req);
      const result = await handlers.search({ json: async () => json });
      const status = result?.status || 200;
      const body = result?.jsonBody ?? result?.body ?? {};
      res.writeHead(status, Object.assign({ 'content-type': 'application/json' }, CORS_HEADERS));
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/aggregate') {
      if (!handlers.aggregate) throw new Error('aggregate handler not registered');
      const { json } = await readBody(req);
      const result = await handlers.aggregate({ json: async () => json });
      const status = result?.status || 200;
      const body = result?.jsonBody ?? result?.body ?? {};
      res.writeHead(status, Object.assign({ 'content-type': 'application/json' }, CORS_HEADERS));
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/mcp') {
      if (!handlers.mcp) throw new Error('mcp handler not registered');
      const { json } = await readBody(req);
      const result = await handlers.mcp({ json: async () => json });
      const status = result?.status || 200;
      const body = result?.jsonBody ?? result?.body ?? {};
      res.writeHead(status, Object.assign({ 'content-type': 'application/json' }, CORS_HEADERS));
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
      return;
    }

    res.writeHead(404, Object.assign({ 'content-type': 'text/plain' }, CORS_HEADERS));
    res.end('Not Found');
  } catch (err) {
    res.writeHead(500, Object.assign({ 'content-type': 'text/plain' }, CORS_HEADERS));
    res.end(String(err?.message || err));
  }
});

const PORT = Number(process.env.PORT || 7071);
server.listen(PORT, () => {
  console.log(`Dev Functions host listening at http://localhost:${PORT}`);
});

