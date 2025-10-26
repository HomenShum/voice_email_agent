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

// Load the stubbed azure functions app (captures handlers on registration)
const af = require(path.resolve('apps/functions/dist/node_modules/@azure/functions/index.js'));

// Load compiled function modules, which will register their handlers with the stub
require(path.resolve('apps/functions/dist/functions/search.js'));
require(path.resolve('apps/functions/dist/functions/aggregate.js'));

const handlers = af.__handlers;
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

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/search') {
      if (!handlers.search) throw new Error('search handler not registered');
      const { json } = await readBody(req);
      const result = await handlers.search({ json: async () => json });
      const status = result?.status || 200;
      const body = result?.jsonBody ?? result?.body ?? {};
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/aggregate') {
      if (!handlers.aggregate) throw new Error('aggregate handler not registered');
      const { json } = await readBody(req);
      const result = await handlers.aggregate({ json: async () => json });
      const status = result?.status || 200;
      const body = result?.jsonBody ?? result?.body ?? {};
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not Found');
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(err?.message || err));
  }
});

const PORT = Number(process.env.PORT || 7071);
server.listen(PORT, () => {
  console.log(`Dev Functions host listening at http://localhost:${PORT}`);
});

