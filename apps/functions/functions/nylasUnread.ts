import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { app } from "@azure/functions";
import { getApiKeyForGrant, hasApiKeyForGrant } from "../shared/nylasConfig.js";

const NYLAS_BASE = process.env.NYLAS_BASE || "https://api.us.nylas.com/v3";

// GET /api/nylas/unread?limit=5&sinceEpoch=...&grantId=...
app.http("nylasUnread", {
  route: "nylas/unread",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    try {
      const url = new URL(req.url);
      const limitRaw = url.searchParams.get("limit") || "5";
      const limit = Math.max(1, Math.min(200, Number(limitRaw) || 5));
      const sinceEpochRaw = url.searchParams.get("sinceEpoch");
      const sinceEpoch = sinceEpochRaw ? Number(sinceEpochRaw) : undefined;
      const grantId = (url.searchParams.get("grantId") || process.env.NYLAS_GRANT_ID || "").trim();
      if (!grantId) return { status: 400, jsonBody: { error: "grantId required" } };


      // If we don't have a configured API key for this grant, return a 400 (bad request)
      if (!hasApiKeyForGrant(grantId)) {
        return { status: 400, jsonBody: { error: "No API key configured for grant" } };
      }

      const apiKey = getApiKeyForGrant(grantId);
      const nylasUrl = new URL(`${NYLAS_BASE}/grants/${encodeURIComponent(grantId)}/messages`);
      nylasUrl.searchParams.set("limit", String(limit));
      nylasUrl.searchParams.set("unread", "true");
      if (sinceEpoch && Number.isFinite(sinceEpoch)) {
        nylasUrl.searchParams.set("received_after", String(Math.floor(sinceEpoch)));
      }

      const r = await fetch(nylasUrl.toString(), {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json, application/gzip" },
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        return { status: r.status, jsonBody: { error: "Nylas unread error", status: r.status, body: t } };
      }
      const data = await r.json();
      return { status: 200, jsonBody: data };
    } catch (e: any) {
      return { status: 500, jsonBody: { error: e?.message || String(e) } };
    }
  },
});

