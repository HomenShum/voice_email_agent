// OpenAI Embeddings via REST fetch to avoid extra deps
// Requires: process.env.OPENAI_API_KEY

const OPENAI_EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

export async function embedTexts(texts) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY env');
  }
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: texts }),
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`OpenAI embeddings failed ${r.status}: ${errText}`);
  }
  const json = await r.json();
  return json.data.map((d) => d.embedding);
}

