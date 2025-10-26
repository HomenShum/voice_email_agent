import { Pinecone, type PineconeRecord, type RecordMetadata } from "@pinecone-database/pinecone";

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME;

export type VectorRecord = PineconeRecord<RecordMetadata>;

export async function upsertVectors(namespace: string, vectors: VectorRecord[]): Promise<void> {
  if (!vectors.length) return;

  if (process.env.SMOKE_TEST === "1" || process.env.PINECONE_DISABLE === "1") {
    console.log(`[Pinecone:NOOP] upsert ${vectors.length} vectors ns=${namespace}`);
    return;
  }

  if (!PINECONE_API_KEY) throw new Error("PINECONE_API_KEY is not configured");
  if (!PINECONE_INDEX_NAME) throw new Error("PINECONE_INDEX_NAME is not configured");

  const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pc.index(PINECONE_INDEX_NAME);
  const ns = index.namespace(namespace);
  // Upsert in a single batch for MVP
  await ns.upsert(vectors);
}

