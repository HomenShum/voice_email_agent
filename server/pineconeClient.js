// Pinecone REST client via fetch (no SDK). Requires env:
// - PINECONE_API_KEY
// - PINECONE_INDEX_HOST (e.g. my-index-xxxxx.svc.us-east1-aws.pinecone.io or full https URL)

function requireEnv() {
  if (!process.env.PINECONE_API_KEY) throw new Error('Missing PINECONE_API_KEY');
  const hostRaw = process.env.PINECONE_INDEX_HOST || '';
  const host = hostRaw.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!host) throw new Error('Missing PINECONE_INDEX_HOST');
  return host;
}

export async function upsertVectors(vectors, namespace = '') {
  const host = requireEnv();
  const url = `https://${host}/vectors/upsert`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Api-Key': process.env.PINECONE_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ vectors, namespace }),
  });
  if (!r.ok) throw new Error(`Pinecone upsert failed ${r.status}: ${await r.text()}`);
  return await r.json();
}

export async function queryTopK(vector, topK = 10, namespace = '', includeMetadata = true, filter) {
  const host = requireEnv();
  const url = `https://${host}/query`;
  const body = { topK, vector, includeMetadata, namespace };
  if (filter) body.filter = filter;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Api-Key': process.env.PINECONE_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Pinecone query failed ${r.status}: ${await r.text()}`);
  return await r.json();
}



export async function describeIndexStats(filter) {
  const host = requireEnv();
  const url = `https://${host}/describe_index_stats`;
  const body = filter && typeof filter === 'object' ? { filter } : {};
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Api-Key': process.env.PINECONE_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Pinecone describe_index_stats failed ${r.status}: ${await r.text()}`);
  return await r.json();
}
