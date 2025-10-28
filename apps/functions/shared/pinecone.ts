import { Pinecone, type PineconeRecord, type RecordMetadata } from "@pinecone-database/pinecone";
import * as fs from "fs";
import * as path from "path";


const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const DENSE_INDEX_NAME =
  process.env.PINECONE_DENSE_INDEX_NAME ||
  process.env.PINECONE_INDEX_NAME ||
  "";
const SPARSE_INDEX_NAME = process.env.PINECONE_SPARSE_INDEX_NAME || "";

const HYBRID_RRF_K = 60;

let client: Pinecone | null = null;
let inferenceClient: any | null = null;

function requireEnv(name: string, value: string) {
  if (!value) {
    throw new Error(`Missing required Pinecone configuration: ${name}`);
  }
}

function getClient(): Pinecone {
  if (!client) {
    requireEnv("PINECONE_API_KEY", PINECONE_API_KEY || "");
    client = new Pinecone({ apiKey: PINECONE_API_KEY! });
  }
  return client;
}

function getInferenceApi(): any | null {
  if (!inferenceClient) {
    const api: any = getClient() as any;
    if (!api?.inference) return null;
    inferenceClient = api.inference;
  }
  return inferenceClient;
}

function getDenseIndex() {
  requireEnv("PINECONE_DENSE_INDEX_NAME", DENSE_INDEX_NAME);
  return getClient().index(DENSE_INDEX_NAME);
}

function getSparseIndexOrNull() {
  if (!SPARSE_INDEX_NAME) return null;
  return getClient().index(SPARSE_INDEX_NAME);
}


// --- Session metrics (in-memory) for monitoring upserts and recent activity ---

type TypeCountMap = Map<string, number>;

type NamespaceSessionMetrics = {
  batches: number;
  records: number;
  byType: TypeCountMap;
  recentIds: string[]; // capped to last 50
  lastUpdated?: string;
};

type ModalitySessionMetrics = {
  indexName: string;
  batches: number;
  records: number;
  byType: TypeCountMap;
  byNamespace: Map<string, NamespaceSessionMetrics>;
  recent: { id: string; ns: string; type?: string; t: number }[]; // capped to last 100
  lastUpdated?: string;
};

const session = {
  startedAt: new Date().toISOString(),
  dense: {
    indexName: DENSE_INDEX_NAME,
    batches: 0,
    records: 0,
    byType: new Map<string, number>(),
    byNamespace: new Map<string, NamespaceSessionMetrics>(),
    recent: [],
  } as ModalitySessionMetrics,
  sparse: {
    indexName: SPARSE_INDEX_NAME,
    batches: 0,
    records: 0,
    byType: new Map<string, number>(),
    byNamespace: new Map<string, NamespaceSessionMetrics>(),
    recent: [],
  } as ModalitySessionMetrics,
};

// --- Persistence: periodically flush session metrics to disk and allow reading persisted snapshot ---
const DATA_DIR = (() => {
  const candidates = [
    process.env.DATA_DIR,
    path.resolve(process.cwd(), ".data"),
    path.resolve(__dirname, "..", ".data"),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      fs.mkdirSync(p, { recursive: true });
      return p;
    } catch {}
  }
  const fallback = path.resolve(process.cwd(), ".data");
  try { fs.mkdirSync(fallback, { recursive: true }); } catch {}
  return fallback;
})();
const METRICS_DIR = path.join(DATA_DIR, "metrics");
try { fs.mkdirSync(METRICS_DIR, { recursive: true }); } catch {}
const METRICS_FILE = path.join(METRICS_DIR, "index-session.json");

let metricsDirty = false;
let lastPersistedAt: string | undefined;
const FLUSH_MS = Number(process.env.INDEX_METRICS_FLUSH_MS || 10000);

function snapshotSession() {
  return {
    startedAt: session.startedAt,
    updatedAt: new Date().toISOString(),
    dense: serializeModality(session.dense),
    sparse: serializeModality(session.sparse),
  };
}

function writeSnapshot(): boolean {
  try {
    const snap = snapshotSession();
    fs.writeFileSync(METRICS_FILE, JSON.stringify(snap, null, 2));
    lastPersistedAt = snap.updatedAt;
    metricsDirty = false;
    return true;
  } catch (e) {
    console.warn("[pinecone] metrics persist failed", (e as any)?.message || e);
    return false;
  }
}

function readPersistedSnapshot(): any | null {
  try {
    if (!fs.existsSync(METRICS_FILE)) return null;
    const txt = fs.readFileSync(METRICS_FILE, "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

setInterval(() => {
  if (metricsDirty) writeSnapshot();
}, Math.max(FLUSH_MS, 1000)).unref?.();

export function getPersistedIndexSession(): any | null {
  return readPersistedSnapshot();
}

export function flushIndexSessionMetricsNow(): boolean {
  return writeSnapshot();
}

export function getIndexMetricsPersistenceInfo() {
  return { dataDir: DATA_DIR, filePath: METRICS_FILE, lastPersistedAt, intervalMs: Math.max(FLUSH_MS, 1000) };
}

function bump(m: TypeCountMap, k: string, d = 1) {
  if (!k) return;
  m.set(k, (m.get(k) || 0) + d);
}

function updateModality(
  modality: "dense" | "sparse",
  namespace: string,
  items: Array<{ id: string; metadata?: RecordMetadata }>
) {
  const mm = session[modality];
  mm.batches += 1;
  mm.records += items.length;
  mm.lastUpdated = new Date().toISOString();

  let ns = mm.byNamespace.get(namespace);
  if (!ns) {
    ns = { batches: 0, records: 0, byType: new Map(), recentIds: [] };
    mm.byNamespace.set(namespace, ns);
  }
  ns.batches += 1;
  ns.records += items.length;
  ns.lastUpdated = mm.lastUpdated;

  for (const it of items) {
    const t = String((it.metadata as any)?.type || "");
    if (t) {
      bump(mm.byType, t, 1);
      bump(ns.byType, t, 1);
    }
    ns.recentIds.push(it.id);
    if (ns.recentIds.length > 50) ns.recentIds.splice(0, ns.recentIds.length - 50);
    mm.recent.push({ id: it.id, ns: namespace, type: t || undefined, t: Date.now() });
    if (mm.recent.length > 100) mm.recent.splice(0, mm.recent.length - 100);
  }
  metricsDirty = true;
}

function top5(map: TypeCountMap): Array<{ type: string; count: number }> {
  return Array.from(map.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function serializeModality(mm: ModalitySessionMetrics) {
  const byNamespace: Record<string, any> = {};
  for (const [ns, v] of mm.byNamespace.entries()) {
    byNamespace[ns] = {
      batches: v.batches,
      records: v.records,
      lastUpdated: v.lastUpdated,
      top5Types: top5(v.byType),
      recentIds: v.recentIds.slice(-5),
    };
  }
  return {
    indexName: mm.indexName,
    batches: mm.batches,
    records: mm.records,
    lastUpdated: mm.lastUpdated,
    top5Types: top5(mm.byType),
    recent: mm.recent.slice(-5),
    byNamespace,
  };
}

export function getIndexSessionMetrics() {
  return {
    startedAt: session.startedAt,
    dense: serializeModality(session.dense),
    sparse: serializeModality(session.sparse),
  };
}

export function resetIndexSessionMetrics() {
  session.dense.batches = 0;
  session.dense.records = 0;
  session.dense.byType.clear();
  session.dense.byNamespace.clear();
  session.dense.recent = [];
  session.dense.lastUpdated = undefined;

  session.sparse.batches = 0;
  session.sparse.records = 0;
  session.sparse.byType.clear();
  session.sparse.byNamespace.clear();
  session.sparse.recent = [];
  session.sparse.lastUpdated = undefined;
}

export async function describeIndexStatsDense(): Promise<any> {
  try {
    return await getDenseIndex().describeIndexStats();
  } catch (e) {
    return { error: String((e as any)?.message || e) };
  }
}

export async function describeIndexStatsSparse(): Promise<any> {
  try {
    const idx = getSparseIndexOrNull();
    if (!idx) return null;
    return await idx.describeIndexStats();
  } catch (e) {
    return { error: String((e as any)?.message || e) };
  }
}

export type VectorRecord = PineconeRecord<RecordMetadata>;

export interface SparseRecord {
  id: string;
  metadata?: RecordMetadata;
  sparseValues?: {
    indices: number[];
    values: number[];
  };
  text?: string;
}

export interface SparseEmbedding {
  indices: number[];
  values: number[];
}

export interface HybridMatch<M = RecordMetadata | undefined> {
  id: string;
  score: number;
  metadata: M;
  source: "dense" | "sparse" | "hybrid";
  denseScore?: number;
  sparseScore?: number;
}

export interface HybridQueryOptions {
  namespace: string;
  vector?: number[];
  sparseEmbedding?: SparseEmbedding;
  filter?: Record<string, unknown>;
  topK?: number;
  denseTopK?: number;
  sparseTopK?: number;
  includeMetadata?: boolean;
  alpha?: number; // optional weighting between dense and sparse (0..1)
}

export async function upsertDenseVectors(namespace: string, vectors: VectorRecord[]): Promise<void> {
  if (!vectors.length) return;
  if (process.env.SMOKE_TEST === "1" || process.env.PINECONE_DISABLE === "1") {
    updateModality("dense", namespace, vectors.map(v => ({ id: v.id, metadata: v.metadata as any })));
    const counts: Record<string, number> = {};
    for (const v of vectors) {
      const t = String((v.metadata as any)?.type || "");
      if (t) counts[t] = (counts[t] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([t,c])=>`${t}:${c}`).join(", ");
    console.log(`[Pinecone:NOOP] upsert dense ${vectors.length} ns=${namespace} top5=[${top}] sampleIds=${vectors.slice(0,5).map(v=>v.id).join(",")}`);
    return;
  }
  const ns = getDenseIndex().namespace(namespace);
  await ns.upsert(vectors);
  updateModality("dense", namespace, vectors.map(v => ({ id: v.id, metadata: v.metadata as any })));
  const counts: Record<string, number> = {};
  for (const v of vectors) {
    const t = String((v.metadata as any)?.type || "");
    if (t) counts[t] = (counts[t] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([t,c])=>`${t}:${c}`).join(", ");
  console.log(`[pinecone] upsert dense ns=${namespace} batch=${vectors.length} top5=[${top}] sampleIds=${vectors.slice(0,5).map(v=>v.id).join(",")}`);
}

export async function upsertSparseRecords(namespace: string, records: SparseRecord[]): Promise<void> {
  if (!records.length) return;
  if (!SPARSE_INDEX_NAME) return;
  if (process.env.SMOKE_TEST === "1" || process.env.PINECONE_DISABLE === "1") {
    updateModality("sparse", namespace, records.map(r => ({ id: r.id, metadata: r.metadata as any })));
    const counts: Record<string, number> = {};
    for (const r of records) {
      const t = String((r.metadata as any)?.type || "");
      if (t) counts[t] = (counts[t] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([t,c])=>`${t}:${c}`).join(", ");
    console.log(`[Pinecone:NOOP] upsert sparse ${records.length} ns=${namespace} top5=[${top}] sampleIds=${records.slice(0,5).map(r=>r.id).join(",")}`);
    return;
  }
  try {
    const ns = getSparseIndexOrNull()?.namespace(namespace);
    if (!ns) return;
    await ns.upsert(
      records.map(({ id, metadata, sparseValues, text }) => {
        if (text !== undefined) {
          return {
            id,
            metadata,
            values: [],
            text,
          } as any;
        }
        return {
          id,
          metadata,
          values: [],
          sparseValues,
        };
      })
    );
    updateModality("sparse", namespace, records.map(r => ({ id: r.id, metadata: r.metadata as any })));
    const counts: Record<string, number> = {};
    for (const r of records) {
      const t = String((r.metadata as any)?.type || "");
      if (t) counts[t] = (counts[t] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([t,c])=>`${t}:${c}`).join(", ");
    console.log(`[pinecone] upsert sparse ns=${namespace} batch=${records.length} top5=[${top}] sampleIds=${records.slice(0,5).map(r=>r.id).join(",")}`);
  } catch (err) {
    console.warn("[pinecone] sparse upsert failed (falling back to dense only)", err);
  }
}

export async function generateSparseEmbedding(
  text: string,
  inputType: "query" | "passage" = "passage"
): Promise<SparseEmbedding> {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return { indices: [], values: [] };
  }
  try {
    const api = getInferenceApi();
    if (!api || typeof api.embed !== "function") {
      // Inference not available in this SDK/runtime; skip sparse
      return { indices: [], values: [] };
    }

    // Prefer modern SDK signature: embed(model, inputs, params)
    let response: any;
    try {
      response = await api.embed(
        "pinecone-sparse-english-v0",
        [trimmed],
        { inputType: inputType, truncate: "END" }
      );
    } catch (e) {
      // Fallback to older object-call style if present in some prereleases
      response = await api.embed({
        model: "pinecone-sparse-english-v0",
        inputs: [trimmed],
        parameters: { input_type: inputType, truncate: "END" },
      } as any);
    }

    const entry = response?.data?.[0];
    // Inference API returns arrays: sparseIndices (number[]) and sparseValues (number[])
    // Some prereleases used snake_case: sparse_indices / sparse_values
    const indices: number[] =
      (entry && (entry as any).sparseIndices) || (entry && (entry as any).sparse_indices) || [];
    const values: number[] =
      (entry && (entry as any).sparseValues) || (entry && (entry as any).sparse_values) || [];
    if (!Array.isArray(indices) || !Array.isArray(values)) {
      throw new Error("Invalid sparse embedding response");
    }
    return { indices, values };
  } catch (err) {
    console.warn("[pinecone] sparse embedding generation failed, returning empty embedding", err);
    return { indices: [], values: [] };
  }
}

function rrfScore(rank: number) {
  return 1 / (HYBRID_RRF_K + rank);
}

export function fuseHybridResults<M = RecordMetadata | undefined>(
  denseMatches: { id: string; score: number; metadata: M }[] = [],
  sparseMatches: { id: string; score: number; metadata: M }[] = [],
  alpha?: number
): HybridMatch<M>[] {
  const scores = new Map<
    string,
    {
      metadata: M;
      denseRank?: number;
      sparseRank?: number;
      denseScore?: number;
      sparseScore?: number;
      total: number;
    }
  >();

  denseMatches.forEach((match, idx) => {
    const current = scores.get(match.id) || { metadata: match.metadata, total: 0 };
    current.metadata = match.metadata;
    current.denseRank ??= idx + 1;
    current.denseScore = match.score;
    current.total += rrfScore(idx + 1);
    scores.set(match.id, current);
  });

  sparseMatches.forEach((match, idx) => {
    const current = scores.get(match.id) || { metadata: match.metadata, total: 0 };
    current.metadata = match.metadata;
    current.sparseRank ??= idx + 1;
    current.sparseScore = match.score;
    current.total += rrfScore(idx + 1);
    scores.set(match.id, current);
  });

  const weightingEnabled = typeof alpha === "number" && alpha >= 0 && alpha <= 1;

  return Array.from(scores.entries())
    .map(([id, details]) => {
      const denseScore = details.denseScore;
      const sparseScore = details.sparseScore;
      const total = weightingEnabled
        ? (denseScore ?? 0) * (alpha as number) + (sparseScore ?? 0) * (1 - (alpha as number))
        : details.total;
      const source =
        denseScore !== undefined && sparseScore !== undefined
          ? "hybrid"
          : denseScore !== undefined
          ? "dense"
          : "sparse";
      return {
        id,
        score: total,
        metadata: details.metadata,
        source,
        denseScore,
        sparseScore,
      } satisfies HybridMatch<M>;
    })
    .sort((a, b) => b.score - a.score);
}

export async function hybridQuery<M = RecordMetadata | undefined>(
  options: HybridQueryOptions
): Promise<{ matches: HybridMatch<M>[]; denseMatches: HybridMatch<M>[]; sparseMatches: HybridMatch<M>[] }> {
  const {
    namespace,
    vector,
    sparseEmbedding,
    filter,
    topK = 10,
    denseTopK = topK,
    sparseTopK = topK,
    includeMetadata = true,
    alpha,
  } = options;

  const denseMatches: HybridMatch<M>[] = [];
  const sparseMatches: HybridMatch<M>[] = [];

  if (vector && vector.length) {
    const denseQuery: any = {
      vector,
      topK: Math.min(Math.max(denseTopK, 1), 200),
      includeMetadata,
      filter,
    };
    const response = await getDenseIndex().namespace(namespace).query(denseQuery);
    for (const match of response.matches ?? []) {
      denseMatches.push({
        id: match.id,
        score: match.score ?? 0,
        metadata: match.metadata as M,
        source: "dense",
        denseScore: match.score ?? 0,
      });
    }
  }

  if (sparseEmbedding && sparseEmbedding.indices.length && sparseEmbedding.values.length) {
    try {
      const sparseIndex = getSparseIndexOrNull();
      if (sparseIndex) {
        const sparseQuery: any = {
          topK: Math.min(Math.max(sparseTopK, 1), 200),
          includeMetadata,
          filter,
          sparseVector: {
            indices: sparseEmbedding.indices,
            values: sparseEmbedding.values,
          },
        };
        const response = await sparseIndex.namespace(namespace).query(sparseQuery);
        for (const match of response.matches ?? []) {
          sparseMatches.push({
            id: match.id,
            score: match.score ?? 0,
            metadata: match.metadata as M,
            source: "sparse",
            sparseScore: match.score ?? 0,
          });
        }
      }
    } catch (err) {
      console.warn("[pinecone] sparse query failed, continuing with dense results only", err);
    }
  }

  // If only one modality available, return it directly.
  if (!denseMatches.length && !sparseMatches.length) {
    return { matches: [], denseMatches, sparseMatches };
  }
  if (!denseMatches.length) {
    return { matches: sparseMatches.slice(0, topK), denseMatches, sparseMatches };
  }
  if (!sparseMatches.length) {
    return { matches: denseMatches.slice(0, topK), denseMatches, sparseMatches };
  }

  const fused = fuseHybridResults(denseMatches, sparseMatches, alpha).slice(0, topK);
  return { matches: fused, denseMatches, sparseMatches };
}

// Backwards compatibility export for existing imports.
export const upsertVectors = upsertDenseVectors;
