import { promises as fs } from "fs";
import * as path from "path";

import { weekKeyFromDayKey } from "./shard.js";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
}

export type DayNote = {
  messageId: string;
  date_iso: string;
  from?: string;
  to?: string[];
  subject?: string;
  excerpt: string;
  thread_id?: string;
};

export async function saveCleanText(grantId: string, messageId: string, text: string) {
  const dir = path.join(DATA_DIR, "grants", grantId, "messages");
  await ensureDir(dir);
  const file = path.join(dir, `${messageId}.txt`);
  await fs.writeFile(file, text, "utf8");
}

export async function saveAttachment(
  grantId: string,
  messageId: string,
  filename: string,
  content: Buffer,
  contentType?: string
) {
  const dir = path.join(DATA_DIR, "grants", grantId, "attachments", messageId);
  await ensureDir(dir);
  const file = path.join(dir, filename);
  await fs.writeFile(file, content);
  if (contentType) {
    const metaFile = path.join(dir, `${filename}.meta.json`);
    await fs.writeFile(metaFile, JSON.stringify({ contentType, filename }, null, 2), "utf8");
  }
}

export async function appendDayNote(
  grantId: string,
  threadId: string | undefined,
  dayKey: string,
  note: DayNote
) {
  const dir = path.join(DATA_DIR, "grants", grantId, "days", dayKey);
  await ensureDir(dir);
  const file = path.join(dir, "notes.jsonl");
  const record = { ...note, thread_id: threadId };
  await fs.appendFile(file, JSON.stringify(record) + "\n", "utf8");
}

export async function loadDayNotes(grantId: string, dayKey: string): Promise<DayNote[]> {
  const file = path.join(DATA_DIR, "grants", grantId, "days", dayKey, "notes.jsonl");
  try {
    const data = await fs.readFile(file, "utf8");
    return data
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DayNote);
  } catch {
    return [];
  }
}

export async function saveSummary(
  grantId: string,
  kind: "day" | "week" | "month" | "thread",
  key: string,
  summary: string
) {
  const dir = path.join(DATA_DIR, "grants", grantId, "summaries", kind);
  await ensureDir(dir);
  const file = path.join(dir, `${key}.txt`);
  await fs.writeFile(file, summary, "utf8");
}

export async function loadSummary(
  grantId: string,
  kind: "day" | "week" | "month" | "thread",
  key: string
): Promise<string | null> {
  const file = path.join(DATA_DIR, "grants", grantId, "summaries", kind, `${key}.txt`);
  try {
    const txt = await fs.readFile(file, "utf8");
    return txt;
  } catch {
    return null;
  }
}

// --- Checkpoint store (per-grant) ---
export async function getCheckpoint(grantId: string): Promise<number> {
  const dir = path.join(DATA_DIR, "grants", grantId, "state");
  const file = path.join(dir, `checkpoint.json`);
  try {
    const txt = await fs.readFile(file, "utf8");
    const json = JSON.parse(txt) as { lastCheckpoint?: number };
    const v = Number(json?.lastCheckpoint || 0);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  } catch {
    return 0;
  }
}

export async function setCheckpoint(grantId: string, epochSeconds: number): Promise<void> {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return;
  const dir = path.join(DATA_DIR, "grants", grantId, "state");
  await ensureDir(dir);
  const file = path.join(dir, `checkpoint.json`);
  let current = 0;
  try {
    const txt = await fs.readFile(file, "utf8");
    const json = JSON.parse(txt) as { lastCheckpoint?: number };
    current = Number(json?.lastCheckpoint || 0) || 0;
  } catch {}
  const next = Math.max(current, Math.floor(epochSeconds));
  const payload = { lastCheckpoint: next, updatedAt: new Date().toISOString() };
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
}

export async function listKnownGrants(): Promise<string[]> {
  const dir = path.join(DATA_DIR, "grants");
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}


// --- Multi-tenant secrets & job progress (dev-friendly file-backed) ---

export type JobStatus = "queued" | "running" | "complete" | "error";

export interface JobRecord {
  jobId: string;
  grantId: string;
  type: "backfill" | "delta" | "other";
  status: JobStatus;
  processed: number;
  total?: number | null;
  createdAt: string;
  updatedAt: string;
  lastSyncTimestamp?: string;
  message?: string;
  indexedVectors?: number;
}

function jobsDir(): string {
  return path.join(DATA_DIR, "jobs");
}

function jobFile(jobId: string): string {
  return path.join(jobsDir(), `${jobId}.json`);
}

export async function createJob(init: Partial<JobRecord> & { grantId: string; type?: JobRecord["type"]; total?: number | null; }): Promise<string> {
  const id = (globalThis as any).crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  const rec: JobRecord = {
    jobId: id,
    grantId: init.grantId,
    type: init.type || "backfill",
    status: "queued",
    processed: Number(init.processed || 0),
    total: typeof init.total === "number" ? init.total : (init.total ?? null),
    createdAt: now,
    updatedAt: now,
  };
  const dir = jobsDir();
  await ensureDir(dir);
  await fs.writeFile(jobFile(id), JSON.stringify(rec, null, 2), "utf8");
  return id;
}

export async function getJob(jobId: string): Promise<JobRecord | null> {
  try {
    const txt = await fs.readFile(jobFile(jobId), "utf8");
    return JSON.parse(txt) as JobRecord;
  } catch {
    return null;
  }
}

export async function updateJob(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
  const current = await getJob(jobId);
  if (!current) return null;
  const next: JobRecord = { ...current, ...patch, updatedAt: new Date().toISOString(), jobId: current.jobId } as JobRecord;
  await ensureDir(jobsDir());
  await fs.writeFile(jobFile(jobId), JSON.stringify(next, null, 2), "utf8");
  return next;
}


export async function listJobs(grantId: string, limit = 24): Promise<JobRecord[]> {
  const dir = jobsDir();
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    const recs = (
      await Promise.all(
        files.map((f) =>
          fs.readFile(path.join(dir, f), "utf8").then((t) => JSON.parse(t) as JobRecord).catch(() => null)
        )
      )
    ).filter((r): r is JobRecord => !!r && r.grantId === grantId);
    recs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return recs.slice(0, Math.max(1, Math.min(1000, limit)));
  } catch {
    return [];
  }
}


// --- Grant secret (dev-only; use Key Vault for prod) ---
export async function setGrantSecret(grantId: string, apiKey: string): Promise<void> {
  const dir = path.join(DATA_DIR, "grants", grantId, "state");
  await ensureDir(dir);
  const file = path.join(dir, `nylas.json`);
  await fs.writeFile(file, JSON.stringify({ apiKey, savedAt: new Date().toISOString() }, null, 2), "utf8");
}

export async function getGrantSecret(grantId: string): Promise<string | null> {
  const file = path.join(DATA_DIR, "grants", grantId, "state", "nylas.json");
  try {
    const txt = await fs.readFile(file, "utf8");
    const json = JSON.parse(txt) as { apiKey?: string };
    return json?.apiKey || null;
  } catch {
    return null;
  }
}

export async function deleteGrantSecret(grantId: string): Promise<void> {
  const file = path.join(DATA_DIR, "grants", grantId, "state", "nylas.json");
  try {
    await fs.rm(file, { force: true });
  } catch {}
}

export async function deleteGrantData(grantId: string): Promise<void> {
  const dir = path.join(DATA_DIR, "grants", grantId);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {}
}

// --- Day key discovery helpers for rollups ---
export async function listDayKeys(grantId: string): Promise<string[]> {
  const dir = path.join(DATA_DIR, "grants", grantId, "days");
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  } catch {
    return [];
  }
}

export async function listDayKeysForWeek(grantId: string, weekKey: string): Promise<string[]> {
  const all = await listDayKeys(grantId);
  return all.filter(dk => weekKeyFromDayKey(dk) === weekKey);
}

export async function listDayKeysForMonth(grantId: string, monthKey: string): Promise<string[]> {
  const all = await listDayKeys(grantId);
  return all.filter(dk => dk.startsWith(monthKey + "-"));
}
