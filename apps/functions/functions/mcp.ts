import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { app } from "@azure/functions";
import { z } from "zod";

function withCors(response: HttpResponseInit): HttpResponseInit {
  return {
    ...response,
    headers: {
      ...response.headers,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS,PUT,DELETE",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,x-functions-key",
    },
  };
}

function baseUrl(): string {
  if (process.env.MCP_DOWNSTREAM_BASE) return process.env.MCP_DOWNSTREAM_BASE;
  const host = process.env.WEBSITE_HOSTNAME;
  if (host) return `https://${host}`;
  return "http://localhost:7071";
}

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

// Zod schemas for MCP tool inputs
const SearchArgsSchema = z.object({
  grantId: z.string().describe("Grant/namespace id"),
  query: z.string(),
  topK: z.number().int().min(1).max(100).optional(),
  types: z.array(z.string()).optional(),
  threadId: z.string().optional(),
  bucket: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const AggregateArgsSchema = SearchArgsSchema.extend({
  groupBy: z.string(),
});

app.http("mcp", {
  route: "mcp",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return withCors({ status: 204 });

    try {
      const payload = (await req.json().catch(() => ({}))) as any;
      const id = payload?.id ?? null;
      const method = String(payload?.method || "");
      const params = (payload?.params || {}) as Record<string, any>;

      const jsonrpc = "2.0";

      if (method === "tools/list") {
        const tools = [
          {
            name: "search_emails",
            description: "Hybrid vector + sparse search over emails/summaries",
            inputSchema: {
              type: "object",
              properties: {
                grantId: { type: "string", description: "Grant/namespace id" },
                query: { type: "string" },
                topK: { type: "number" },
                types: { type: "array", items: { type: "string" } },
                threadId: { type: "string" },
                bucket: { type: "string" },
                dateFrom: { type: "string" },
                dateTo: { type: "string" }
              },
              required: ["grantId", "query"]
            }
          },
          {
            name: "aggregate_emails",
            description: "Aggregate counts grouped by metadata (e.g. from_domain)",
            inputSchema: {
              type: "object",
              properties: {
                grantId: { type: "string" },
                query: { type: "string" },
                topK: { type: "number" },
                types: { type: "array", items: { type: "string" } },
                groupBy: { type: "string" },
                threadId: { type: "string" },
                bucket: { type: "string" },
                dateFrom: { type: "string" },
                dateTo: { type: "string" }
              },
              required: ["grantId", "query", "groupBy"]
            }
          }
        ];
        return withCors({ status: 200, jsonBody: { jsonrpc, id, result: { tools, nextCursor: null } } });
      }

      if (method === "tools/call") {
        const name = String(params?.name || "");
        const args = (params?.arguments || {}) as Record<string, any>;
        const root = baseUrl();

        async function call(path: string, body: Json): Promise<any> {
          const r = await fetch(`${root}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body ?? {})
          });
          const txt = await r.text();
          try { return JSON.parse(txt); } catch { return { ok: r.ok, status: r.status, body: txt }; }
        }

        try {
          if (name === "search_emails") {
            const parsed = SearchArgsSchema.safeParse(args);
            if (!parsed.success) {
              return withCors({ status: 200, jsonBody: { jsonrpc, id, error: { code: -32602, message: "Invalid params for search_emails", data: parsed.error.flatten() } } });
            }
            const a = parsed.data;
            const res = await call("/api/search", {
              grantId: a.grantId,
              query: a.query,
              topK: a.topK,
              types: a.types,
              threadId: a.threadId,
              bucket: a.bucket,
              dateFrom: a.dateFrom,
              dateTo: a.dateTo,
            });
            const text = typeof res === "string" ? res : JSON.stringify(res);
            return withCors({ status: 200, jsonBody: { jsonrpc, id, result: { content: [{ type: "text", text }], structuredContent: res } } });
          }

          if (name === "aggregate_emails") {
            const parsed = AggregateArgsSchema.safeParse(args);
            if (!parsed.success) {
              return withCors({ status: 200, jsonBody: { jsonrpc, id, error: { code: -32602, message: "Invalid params for aggregate_emails", data: parsed.error.flatten() } } });
            }
            const a = parsed.data;
            const res = await call("/api/aggregate", {
              grantId: a.grantId,
              query: a.query,
              topK: a.topK,
              types: a.types,
              groupBy: a.groupBy,
              threadId: a.threadId,
              bucket: a.bucket,
              dateFrom: a.dateFrom,
              dateTo: a.dateTo,
            });
            const text = typeof res === "string" ? res : JSON.stringify(res);
            return withCors({ status: 200, jsonBody: { jsonrpc, id, result: { content: [{ type: "text", text }], structuredContent: res } } });
          }

          return withCors({ status: 200, jsonBody: { jsonrpc, id, error: { code: -32601, message: `Tool not found: ${name}` } } });
        } catch (err: any) {
          const message = String(err?.message || err || "Unknown error");
          return withCors({ status: 200, jsonBody: { jsonrpc, id, result: { isError: true, content: [{ type: "text", text: message }] } } });
        }
      }

      return withCors({ status: 200, jsonBody: { jsonrpc, id, error: { code: -32601, message: `Method not found: ${method}` } } });
    } catch (e: any) {
      return withCors({ status: 500, body: String(e?.message || e) });
    }
  }
});

