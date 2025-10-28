import type { HttpRequest, HttpResponseInit } from "@azure/functions";

function loadAzureFunctionsRuntime(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("path");
  const realDir = path.resolve(process.cwd(), "node_modules", "@azure", "functions");
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(realDir);
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("@azure/functions");
  }
}

const { app } = loadAzureFunctionsRuntime();
// Compute ISO 8601 week start/end (UTC) from a key like "2025-W43".
function computeIsoWeekRange(weekKey: string): { startIso: string; endIso: string } | null {
  if (!/^\d{4}-W\d{2}$/.test(weekKey)) return null;
  const [yearStr, wkStr] = weekKey.split("-W");
  const year = Number(yearStr);
  const week = Number(wkStr);
  if (!year || !week) return null;
  // ISO week 1 is the week with Jan 4th; Monday is first day of week
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7; // 1..7 (Mon..Sun)
  const week1Mon = new Date(Date.UTC(year, 0, 4 - (jan4Dow - 1)));
  const weekStart = new Date(week1Mon.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
  const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
  // Normalize boundaries to full-day ISO strings
  const startIso = new Date(Date.UTC(
    weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate(), 0, 0, 0, 0
  )).toISOString();
  const endIso = new Date(Date.UTC(
    weekEnd.getUTCFullYear(), weekEnd.getUTCMonth(), weekEnd.getUTCDate(), 23, 59, 59, 999
  )).toISOString();
  return { startIso, endIso };
}
// Extract a literal subject like "X @ Y" from a natural language query.
function extractAtSubjectLiteral(q: string): string | null {
  try {
    const m = q.match(/([A-Za-z0-9'&+\.\-]+(?:\s+[A-Za-z0-9'&+\.\-]+)*)\s*@\s*([A-Za-z0-9'&+\.\-]+(?:\s+[A-Za-z0-9'&+\.\-]+)*)/);
    if (!m) return null;
    const left = m[1].replace(/\s+/g, ' ').trim();
    const right = m[2].replace(/\s+/g, ' ').trim();
    if (!left || !right) return null;
    return `${left} @ ${right}`;
  } catch {
    return null;
  }
}


import { embedText } from "../shared/openai";
import { generateSparseEmbedding, hybridQuery } from "../shared/pinecone";
import { loadSummary, getCheckpoint } from "../shared/storage";

// POST /api/search
// Body: { grantId, query, topK=10, types?, threadId?, dateFrom?, dateTo?, bucket? }
app.http("search", {
  route: "search",
  methods: ["POST"],
  authLevel: "function",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as any;
      const {
        grantId,
        query,
        topK = 10,
        types,
        threadId,
        dateFrom,
        dateTo,
        bucket,
      } = body || {};

      if (!grantId || !query) return { status: 400, body: "grantId and query required" };
      if (!process.env.PINECONE_API_KEY) return { status: 500, body: "Missing PINECONE_API_KEY" };
      if (!process.env.PINECONE_DENSE_INDEX_NAME && !process.env.PINECONE_INDEX_NAME) {
        return { status: 500, body: "Missing PINECONE_DENSE_INDEX_NAME (or legacy PINECONE_INDEX_NAME)" };
      }

      const vec = await embedText(String(query));
      const sparseEmbedding = await generateSparseEmbedding(String(query), "query");

      const filter: Record<string, any> = {};
      const normalizeTypes = (arr?: string[]) => {
        if (!Array.isArray(arr) || !arr.length) return undefined;
        const out = new Set<string>();
        for (const t of arr) {
          switch (t) {
            case "message":
              out.add("message"); out.add("email"); break; // legacy compatibility
            case "thread_day":
              out.add("thread_day"); out.add("summary_day"); out.add("thread"); break;
            case "thread_week":
              out.add("thread_week"); out.add("summary_week"); out.add("thread"); break;
            case "thread_month":
              out.add("thread_month"); out.add("summary_month"); out.add("thread"); break;
            default:
              out.add(t);
          }
        }
        return Array.from(out);
      };
      const typesNorm = normalizeTypes(types);
      if (typesNorm) filter.type = { "$in": typesNorm };
      if (threadId) filter.thread_id = threadId;
      if (bucket) filter.bucket = bucket;
      if (dateFrom || dateTo) {
        filter.date = {} as any;
        if (dateFrom) filter.date["$gte"] = dateFrom;
        if (dateTo) filter.date["$lte"] = dateTo;
      }

      const involvesMessages = !typesNorm || typesNorm.some((t) => ["message", "email"].includes(String(t)));
      const isUnreadQuery = /unread/i.test(String(query));
      let appliedCheckpoint: number | null = null;
      if (involvesMessages && !filter.date && isUnreadQuery) {
        const checkpoint = await getCheckpoint(String(grantId));
        if (checkpoint > 0) {
          filter.date = { $gte: checkpoint };
          appliedCheckpoint = checkpoint;
        }
      }

      const requestedTopK = Math.min(Number(topK) || 10, 100);
      const { matches } = await hybridQuery({
        namespace: String(grantId),
        vector: vec,
        sparseEmbedding,
        filter: Object.keys(filter).length ? filter : undefined,
        topK: requestedTopK,
        denseTopK: Math.min(requestedTopK * 3, 200),
        sparseTopK: Math.min(requestedTopK * 3, 200),
        includeMetadata: true,
      });

      // Prefer exact type matches when the caller specified a concrete summary type.
      // This helps ensure 'thread_week' requests surface per-thread weekly summaries over generic weekly rollups.
      let ranked = matches.slice();
      if (Array.isArray(types) && types.length) {
        const pref = new Set<string>(types);
        const boost = (m: any) => {
          const t = String((m.metadata as any)?.type || "");
          if (pref.has("thread_week") && t === "thread_week") return 0.25;
          if (pref.has("thread_week") && t === "summary_week") return -0.05;
          if (pref.has("thread_day") && t === "thread_day") return 0.25;
          if (pref.has("thread_month") && t === "thread_month") return 0.25;
          return 0;
        };
        ranked.sort((a, b) => (b.score + boost(b)) - (a.score + boost(a)));
      }

      let augmented: any[] = [];
      for (const match of ranked) {
        const metadata = { ...(match.metadata as Record<string, unknown> | undefined) };
        if (metadata && /unread/i.test(String(query)) && typeof metadata.unread === "undefined") {
          metadata.unread = true;
        }
        if (metadata && appliedCheckpoint) {
          (metadata as any).received_after = appliedCheckpoint;
          try {
            const iso = new Date(appliedCheckpoint * 1000).toISOString();
            (metadata as any).received_after_iso = iso;
          } catch {}
        }
        if (metadata) {
          const scope = String(metadata.summary_scope || "").toLowerCase();
          let kind: "day" | "week" | "month" | "thread" | null = null;
          let key: string | null = null;
          if (scope === "day") {
            kind = "day";
            key = String(metadata.day_key || "");
          } else if (metadata.type === "thread_week") {
            // For per-thread weekly summaries we persist under the 'thread' kind with a compound key
            kind = "thread";
            const tid = String((metadata as any).thread_id || "");
            const wk = String((metadata as any).week_key || "");
            key = tid && wk ? `${tid}@${wk}` : null;
          } else if (scope === "week" || metadata.type === "summary_week") {
            kind = "week";
            key = String(metadata.week_key || "");
          } else if (scope === "month" || metadata.type === "summary_month" || metadata.type === "thread_month") {
            kind = "month";
            key = String(metadata.month_key || "");
          } else if (scope === "thread" || metadata.type === "thread") {
            kind = "thread";
            key = String(metadata.thread_id || "");
          }
          if (kind && key) {
            // Expose the resolved summary key/kind for debugging and tests
            (metadata as any).summary_kind = kind;
            (metadata as any).summary_key = key;
            const summaryText = await loadSummary(String(grantId), kind, key);
            if (summaryText) {
              (metadata as any).summary_source = "file";
              metadata.summary_text = summaryText;
            } else {
              (metadata as any).summary_source = "metadata";
            }
          }
          // After resolving summary_text, augment with exact ISO week range when week_key is present
          const wkKey2 = String((metadata as any).week_key || "");
          if (wkKey2) {
            const range2 = computeIsoWeekRange(wkKey2);
            if (range2) {
              (metadata as any).week_start_iso = range2.startIso;
              (metadata as any).week_end_iso = range2.endIso;
            }
          }

        }
        augmented.push({ ...match, metadata });
      }

      // If the query names a specific thread using an "X @ Y" literal and the caller requested
      // per-thread weekly summaries, prune results to that subject to avoid cross-thread contradictions.
      const subjectLiteral = extractAtSubjectLiteral(String(query || ""));
      if (subjectLiteral && Array.isArray(types) && types.includes("thread_week")) {
        const needle = subjectLiteral.toLowerCase();
        const filtered = augmented.filter((m) =>
          String(m?.metadata?.summary_text || "").toLowerCase().includes(needle)
        );
        if (filtered.length > 0) {
          augmented = filtered;
        }
      }
      // Prefer persisted summaries when available, then fallback to score ordering.
      augmented.sort((a, b) => {
        const af = String(a?.metadata?.summary_source || "") === "file" ? 1 : 0;
        const bf = String(b?.metadata?.summary_source || "") === "file" ? 1 : 0;
        if (af !== bf) return bf - af;
        return (b.score || 0) - (a.score || 0);
      });


      return { status: 200, jsonBody: { matches: augmented } };
    } catch (e: any) {
      return { status: 500, body: String(e?.message || e) };
    }
  },
});

