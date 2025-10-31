import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { app } from "@azure/functions";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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

// Zod schemas for MCP tool inputs (define shapes for SDK registerTool)
const SearchArgsShape = {
  grantId: z.string().describe("Grant/namespace id"),
  query: z.string(),
  topK: z.number().int().min(1).max(100).optional(),
  types: z.array(z.string()).optional(),
  threadId: z.string().optional(),
  bucket: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
};
const AggregateArgsShape = { ...SearchArgsShape, groupBy: z.string() };

// Simple downstream caller used by tools
async function callDownstream(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const txt = await r.text();
  try { return JSON.parse(txt); } catch { return { ok: r.ok, status: r.status, body: txt }; }
}

// Create MCP server once per worker (still used for typed registration; transport is manually bridged)
const server = new McpServer({ name: "email-agent-mcp", version: "1.0.0" });

// Optional Zod objects for runtime validation
const SearchArgsSchema = z.object(SearchArgsShape);
const AggregateArgsSchema = z.object(AggregateArgsShape);

// Register tools for discoverability/consistency
server.registerTool(
  "search_emails",
  {
    title: "Search Emails",
    description: "Hybrid vector + sparse search over emails/summaries",
    inputSchema: SearchArgsShape,
  },
  async (args: any) => {
    const res = await callDownstream("/api/search", args);
    return { content: [{ type: "text", text: JSON.stringify(res) }], structuredContent: res };
  }
);
server.registerTool(
  "aggregate_emails",
  {
    title: "Aggregate Emails",
    description: "Aggregate counts grouped by metadata (e.g. from_domain)",
    inputSchema: AggregateArgsShape,
  },
  async (args: any) => {
    const res = await callDownstream("/api/aggregate", args);
    return { content: [{ type: "text", text: JSON.stringify(res) }], structuredContent: res };
  }
);

// Minimal JSON Schema generator for our limited Zod shapes
function zodShapeToJsonSchema(shape: Record<string, any>) {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  const toSchema = (node: any): any => {
    if (node instanceof z.ZodOptional) return toSchema((node as any)._def.innerType);
    if (node instanceof z.ZodString) return { type: "string", description: (node as any).description || (node as any)._def?.description };
    if (node instanceof z.ZodNumber) {
      const checks = (node as any)._def?.checks || [];
      const isInt = checks.some((c: any) => c.kind === "int");
      const min = checks.find((c: any) => c.kind === "min")?.value;
      const max = checks.find((c: any) => c.kind === "max")?.value;
      const s: any = { type: isInt ? "integer" : "number" };
      if (typeof min === "number") s.minimum = min;
      if (typeof max === "number") s.maximum = max;
      return s;
    }
    if (node instanceof z.ZodArray) return { type: "array", items: toSchema((node as any)._def?.type) };
    return {};
  };
  for (const [k, v] of Object.entries(shape)) {
    const isOpt = v instanceof z.ZodOptional;
    if (!isOpt) required.push(k);
    properties[k] = toSchema(v);
  }
  return { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties, required };
}

app.http("mcp", {
  route: "mcp",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return withCors({ status: 204 });
    try {
      const body: any = await req.json().catch(() => ({}));
      if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
        return withCors({ status: 400, jsonBody: { jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request" }, id: null } });
      }

      if (body.method === "tools/list") {
        const tools = [
          {
            name: "search_emails",
            description: "Hybrid vector + sparse search over emails/summaries",
            input_schema: zodShapeToJsonSchema(SearchArgsShape),
          },
          {
            name: "aggregate_emails",
            description: "Aggregate counts grouped by metadata (e.g. from_domain)",
            input_schema: zodShapeToJsonSchema(AggregateArgsShape),
          },
        ];
        return withCors({ status: 200, jsonBody: { jsonrpc: "2.0", id: body.id ?? null, result: { tools } } });
      }

      if (body.method === "tools/call") {
        const name = body.params?.name as string;
        const args = body.params?.arguments ?? {};
        if (name === "search_emails") {
          const parsed = SearchArgsSchema.safeParse(args);
          if (!parsed.success) {
            return withCors({ status: 200, jsonBody: { jsonrpc: "2.0", id: body.id ?? null, error: { code: -32602, message: "Invalid params", data: parsed.error.flatten() } } });
          }
          const res = await callDownstream("/api/search", parsed.data);
          return withCors({ status: 200, jsonBody: { jsonrpc: "2.0", id: body.id ?? null, result: { content: [{ type: "text", text: JSON.stringify(res) }], structuredContent: res } } });
        }
        if (name === "aggregate_emails") {
          const parsed = AggregateArgsSchema.safeParse(args);
          if (!parsed.success) {
            return withCors({ status: 200, jsonBody: { jsonrpc: "2.0", id: body.id ?? null, error: { code: -32602, message: "Invalid params", data: parsed.error.flatten() } } });
          }
          const res = await callDownstream("/api/aggregate", parsed.data);
          return withCors({ status: 200, jsonBody: { jsonrpc: "2.0", id: body.id ?? null, result: { content: [{ type: "text", text: JSON.stringify(res) }], structuredContent: res } } });
        }
        return withCors({ status: 200, jsonBody: { jsonrpc: "2.0", id: body.id ?? null, error: { code: -32601, message: `Tool not found: ${name}` } } });
      }

      return withCors({ status: 200, jsonBody: { jsonrpc: "2.0", id: body.id ?? null, error: { code: -32601, message: `Method not found: ${body.method}` } } });
    } catch (e: any) {
      console.error("MCP endpoint error:", e);
      return withCors({ status: 500, jsonBody: { jsonrpc: "2.0", error: { code: -32603, message: String(e?.message || e), data: { stack: e?.stack } }, id: null } });
    }
  },
});
