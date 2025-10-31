import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { app } from "@azure/functions";
import { getApiKeyForGrant, hasApiKeyForGrant } from "../shared/nylasConfig.js";

const NYLAS_BASE = process.env.NYLAS_BASE || "https://api.us.nylas.com/v3";

// GET /api/nylas/contacts?limit=5&grantId=...
app.http("nylasContacts", {
  route: "nylas/contacts",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    try {
      const url = new URL(req.url);
      const limitRaw = url.searchParams.get("limit") || "5";
      const limit = Math.max(1, Math.min(200, Number(limitRaw) || 5));
      const grantId = (url.searchParams.get("grantId") || process.env.NYLAS_GRANT_ID || "").trim();
      if (!grantId) return { status: 400, jsonBody: { error: "grantId required" } };


      if (!hasApiKeyForGrant(grantId)) {
        return { status: 400, jsonBody: { error: "No API key configured for grant" } };
      }

      const apiKey = getApiKeyForGrant(grantId);
      const nylasUrl = new URL(`${NYLAS_BASE}/grants/${encodeURIComponent(grantId)}/contacts`);
      nylasUrl.searchParams.set("limit", String(limit));

      const r = await fetch(nylasUrl.toString(), {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json, application/gzip" },
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        return { status: r.status, jsonBody: { error: "Nylas contacts error", status: r.status, body: t } };
      }
      const data = await r.json();
      return { status: 200, jsonBody: data };
    } catch (e: any) {
      return { status: 500, jsonBody: { error: e?.message || String(e) } };
    }
  },
});

