import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { app } from "@azure/functions";

// Helper to add CORS headers to responses
function withCors(response: HttpResponseInit): HttpResponseInit {
  return {
    ...response,
    headers: {
      ...response.headers,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS,PUT,DELETE",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
  };
}

// POST /api/realtime/session
// Body: { model?: string }
// Returns: { client_secret: { value: string } } (normalized)
app.http("realtimeSession", {
  route: "realtime/session",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    // Handle preflight requests
    if (req.method === "OPTIONS") {
      return withCors({ status: 204 });
    }

    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return withCors({ status: 500, jsonBody: { error: "Missing OPENAI_API_KEY" } });
      }

      let body: any = undefined;
      try { body = await req.json(); } catch { /* ignore bad json */ }
      const requestedModel = (typeof body?.model === "string" && body.model.trim()) || "gpt-realtime-mini";

      const upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ session: { type: "realtime", model: requestedModel } }),
      });

      const ct = upstream.headers.get("content-type") || "";
      if (upstream.ok) {
        const payload: any = ct.includes("application/json") ? await upstream.json() : { value: await upstream.text() };
        // Normalize GA shape { value: "ek_..." } to SDK-friendly { client_secret: { value } }
        const normalized = payload?.value ? { client_secret: { value: payload.value } } : payload;
        return withCors({ status: 200, jsonBody: normalized });
      }

      const errText = await upstream.text().catch(() => "");
      return withCors({ status: upstream.status, jsonBody: { error: "OpenAI realtime session create error", status: upstream.status, body: errText } });
    } catch (e: any) {
      return withCors({ status: 500, jsonBody: { error: e?.message || String(e) } });
    }
  },
});
