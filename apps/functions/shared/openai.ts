import OpenAI from "openai";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5-mini";

if (!OPENAI_API_KEY) {
  // Don't throw at import time to allow tooling to load; throw when used instead
}

// --- Cleaning helpers ---
export function cleanText(htmlOrText: string | null | undefined): string {
  if (!htmlOrText) return "";
  // Very simple HTML stripper for MVP
  const noTags = htmlOrText.replace(/<[^>]*>/g, " ");
  return noTags.replace(/\s+/g, " ").trim();
}
export const htmlToText = cleanText;

// --- Embeddings (Text Embedding 3 family) ---
export async function embedText(text: string): Promise<number[]> {
  if (process.env.SMOKE_TEST === "1") {
    // Return a deterministic small vector for smoke tests without hitting OpenAI
    const dim = Number(process.env.OPENAI_EMBED_DIM || 64);
    return Array(dim).fill(0).map((_, i) => (i % 7 === 0 ? 0.1 : 0));
  }

  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const MAX_EMBED_CHARS = Number(process.env.OPENAI_EMBED_MAX_CHARS || '12000');
  const trimmed = typeof text === 'string' && text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;
  const res = await client.embeddings.create({
    model: OPENAI_EMBED_MODEL,
    input: trimmed,
  });
  const embedding = res?.data?.[0]?.embedding as number[] | undefined;
  if (!embedding) throw new Error("Failed to generate embedding");
  return embedding;
}

// --- Summarization (gpt-5-mini via Responses API) ---
export async function summarizeText(text: string, hint?: string): Promise<string> {
  if (process.env.SMOKE_TEST === "1") {
    return (hint ? `[SMOKE] ${hint}\n` : "") + text.slice(0, 140);
  }
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const input = hint ? `${hint}\n\n${text}` : text;
  const res = await client.responses.create({ model: OPENAI_TEXT_MODEL, input,  });
  return res.output_text ?? "";
}

// Map-Reduce summarization for large texts to fit within embedding limits
export async function summarizeLongTextMapReduce(text: string, hint?: string): Promise<string> {
  const RAW_CHUNK_CHARS = Number(process.env.RAW_CHUNK_CHARS || '15000');
  const CHUNK_OVERLAP_CHARS = Number(process.env.CHUNK_OVERLAP_CHARS || '1500');
  const FINAL_SUMMARY_MAX_CHARS = Number(process.env.FINAL_SUMMARY_MAX_CHARS || '8000');
  const makeMapPrompt = (t: string) => [
    'Summarize the following into tight bullets, one idea per line; include dates, actors, and actions when present.',
    'After bullets, include one short executive paragraph and up to 8 concise tags.',
    hint ? `Hint: ${hint}` : null,
    '',
    t,
  ].filter(Boolean).join('\n');

  if (text.length <= RAW_CHUNK_CHARS) {
    const out = await summarizeText(makeMapPrompt(text));
    return out.length > FINAL_SUMMARY_MAX_CHARS ? out.slice(0, FINAL_SUMMARY_MAX_CHARS) : out;
  }

  // Map
  const parts: string[] = [];
  for (let i = 0; i < text.length; ) {
    const j = Math.min(text.length, i + RAW_CHUNK_CHARS);
    const chunk = text.slice(i, j);
    const sum = await summarizeText(makeMapPrompt(chunk), 'Chunk summary');
    parts.push(sum);
    const next = j - CHUNK_OVERLAP_CHARS;
    i = next > i ? next : j;
  }
  // Reduce
  const reduceHint = 'Combine and deduplicate the chunk summaries into bullets + a short paragraph + tags.';
  const final = await summarizeText(parts.join('\n\n'), reduceHint);
  return final.length > FINAL_SUMMARY_MAX_CHARS ? final.slice(0, FINAL_SUMMARY_MAX_CHARS) : final;
}


export type NoteForSummary = {
  date_iso: string;
  subject?: string;
  from?: string;
  to?: string[];
  excerpt: string;
};

export async function summarizeNotes(notes: NoteForSummary[], hint?: string): Promise<string> {
  const lines = notes.map(n => `- [${n.date_iso}] ${n.from ? n.from + " → " : ""}${(n.to ?? []).join(", ")} :: ${n.subject ?? ""} :: ${n.excerpt}`);
  const maxPerChunk = Number(process.env.SUMMARY_NOTES_PER_CHUNK || '50');

  const makePrompt = (ls: string[]) => [
    "Summarize these email snippets into:",
    "1) 3–7 bullet points (actionable).",
    "2) 1 short executive paragraph.",
    "3) Up to 8 searchable tags.",
    hint ? `Hint: ${hint}` : null,
    "",
    ls.join("\n"),
  ].filter(Boolean).join("\n");

  if (lines.length <= maxPerChunk) {
    return summarizeText(makePrompt(lines));
  }

  // Chunk large note sets to stay within model context limits, then synthesize
  const partials: string[] = [];
  for (let i = 0; i < lines.length; i += maxPerChunk) {
    const chunk = lines.slice(i, i + maxPerChunk);
    const part = await summarizeText(makePrompt(chunk), "Chunk summary");
    partials.push(part);
  }
  const finalHint = "Combine and deduplicate the following chunk summaries into the same output format (bullets, paragraph, tags).";
  return summarizeText(partials.join("\n\n"), finalHint);
}

// --- Image analysis (use Chat Completions for multimodal until Responses types stabilize) ---
export async function analyzeImageBuffer(buf: Buffer, mime: string, filename: string): Promise<string> {
  if (process.env.SMOKE_TEST === "1") {
    return `[SMOKE] image analysis for ${filename} (${mime}), ${buf.length} bytes`;
  }
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const b64 = buf.toString("base64");
  const dataUrl = `data:${mime};base64,${b64}`;
  const chat = await client.chat.completions.create({
    model: OPENAI_TEXT_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `Summarize file "${filename}". Extract key topics, action items, and tags.` },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  return chat.choices?.[0]?.message?.content ?? "";
}

// --- PDF analysis (naive byte-to-ascii extraction + summarization) ---
export async function analyzePdfBuffer(buf: Buffer, filename: string): Promise<string> {
  if (process.env.SMOKE_TEST === "1") {
    return `[SMOKE] pdf analysis for ${filename}, ${buf.length} bytes`;
  }
  // Fallback approach without external deps: extract visible ASCII and summarize with chunking to avoid context limits.
  const ascii = buf
    .toString("latin1")
    .replace(/[^\x09\x0a\x0d\x20-\x7E]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!ascii) return `No extractable text found in ${filename}.`;

  const hint = `You are analyzing PDF "${filename}". Provide a concise summary, key topics, action items, and tags. The text was extracted heuristically.`;
  const maxChunkChars = Number(process.env.PDF_SUMMARY_CHARS || '16000');

  if (ascii.length <= maxChunkChars) {
    return summarizeText(ascii, hint);
  }

  // Chunk large PDFs and synthesize a final summary
  const partials: string[] = [];
  for (let i = 0; i < ascii.length; i += maxChunkChars) {
    const chunk = ascii.slice(i, i + maxChunkChars);
    const part = await summarizeText(chunk, `Chunk summary for ${filename}`);
    partials.push(part);
  }
  return summarizeText(partials.join("\n\n"), `Synthesize final summary for ${filename}. Merge, deduplicate, and format as bullets, paragraph, and tags.`);
}
