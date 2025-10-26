import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { Pinecone } from "@pinecone-database/pinecone";
import { embedText } from "../shared/openai";

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
        topK: Math.min(Number(topK) || 10, 100),
        includeMetadata: true,
        filter: Object.keys(filter).length ? filter : undefined,
      });

      // Return Pinecone matches directly for richer judging; consumer can map as needed
      return { status: 200, jsonBody: { matches: resp.matches ?? [] } };
    } catch (e: any) {
      return { status: 500, body: String(e?.message || e) };
    }
  },
});

