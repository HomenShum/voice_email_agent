import { promises as fs } from "fs";
import * as path from "path";

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
