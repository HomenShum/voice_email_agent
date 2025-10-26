import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { Pinecone } from "@pinecone-database/pinecone";
import { embedText } from "../shared/openai";

// POST /api/aggregate
// Body: { grantId, query, topK=50, types?, threadId?, dateFrom?, dateTo?, bucket?, groupBy="from_domain" }
app.http("aggregate", {
  route: "aggregate",
  methods: ["POST"],
  authLevel: "function",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as any;
      const {
        grantId,
        query,
        topK = 50,
        types,
        threadId,
        dateFrom,
        dateTo,
        bucket,
        groupBy = "from_domain",
      } = body || {};

      if (!grantId || !query) return { status: 400, body: "grantId and query required" };
      if (!process.env.PINECONE_API_KEY) return { status: 500, body: "Missing PINECONE_API_KEY" };
      if (!process.env.PINECONE_INDEX_NAME) return { status: 500, body: "Missing PINECONE_INDEX_NAME" };

      const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
      const index = pc.index(process.env.PINECONE_INDEX_NAME!);
      const vec = await embedText(String(query));

      const filter: Record<string, any> = {};
      const normalizeTypes = (arr?: string[]) => {
        if (!Array.isArray(arr) || !arr.length) return undefined;
        const out = new Set<string>();
        for (const t of arr) {
          switch (t) {
            case "message":
              out.add("message"); out.add("email"); break; // legacy compatibility
            case "thread_day":
              out.add("thread_day"); out.add("summary_day"); break;
            case "thread_week":
              out.add("thread_week"); out.add("summary_week"); break;
            case "thread_month":
              out.add("thread_month"); out.add("summary_month"); break;
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
        filter.date_created = {} as any;
        if (dateFrom) filter.date_created["$gte"] = dateFrom;
        if (dateTo) filter.date_created["$lte"] = dateTo;
      }

      const ns = index.namespace(String(grantId));
      const resp = await ns.query({
        vector: vec,
        topK: Math.min(Number(topK) || 50, 1000),
        includeMetadata: true,
        filter: Object.keys(filter).length ? filter : undefined,
      });

      const counts = new Map<string, number>();
      const toDomain = (email?: string) => {
        const m = (email || "").match(/@([^> ]+)/);
        return m ? m[1].toLowerCase() : "";
      };

      for (const m of resp.matches || []) {
        const md = (m.metadata as any) || {};
        if (groupBy === "from_domain") {
          const d = toDomain(md.from);
          if (!d) continue;
          counts.set(d, (counts.get(d) || 0) + 1);
        } else if (groupBy === "thread_id") {
          const k = md.thread_id || "";
          if (!k) continue;
          counts.set(k, (counts.get(k) || 0) + 1);
        } else {
          const k = String(md[groupBy] ?? "");
          if (!k) continue;
          counts.set(k, (counts.get(k) || 0) + 1);
        }
      }

      return {
        status: 200,
        jsonBody: {
          groupBy,
          counts: Array.from(counts.entries()).map(([key, count]) => ({ key, count })),
        },
      };
    } catch (e: any) {
      return { status: 500, body: String(e?.message || e) };
    }
  },
});

