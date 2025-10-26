import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import crypto from "node:crypto";
import { enqueueBackfill } from "../shared/bus";

function ok(body: any): HttpResponseInit { return { status: 200, jsonBody: body }; }
function accepted(body: any): HttpResponseInit { return { status: 202, jsonBody: body }; }
function bad(msg: string): HttpResponseInit { return { status: 400, jsonBody: { ok: false, error: msg } }; }

// Optionally verify signature in future: X-Nylas-Signature HMAC-SHA256 over body using webhook_secret
// For dev/minimal path we skip verification; ensure to harden in production.

app.http("nylasWebhook", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "webhooks/nylas",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      if (req.method === "GET") {
        const challenge = (req.query.get("challenge") || "").trim();
        if (!challenge) return bad("Missing challenge");
        // Nylas expects exact value echoed back with 200 OK
        return { status: 200, body: challenge, headers: { "content-type": "text/plain" } };
      }

      // POST: verify signature (if secret configured) and process notifications
      const secret = (process.env.NYLAS_WEBHOOK_SECRET || "").trim();
      const sigHeader = (req.headers.get("x-nylas-signature") || req.headers.get("X-Nylas-Signature") || "").toString();

      const raw = await req.text();
      if (!raw) return bad("Missing body");

      if (secret) {
        try {
          const digestHex = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
          const a = Buffer.from(digestHex, "hex");
          const b = Buffer.from((sigHeader || ""), "hex");
          if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            ctx.warn?.("nylasWebhook: signature verification failed");
            return { status: 401, jsonBody: { ok: false, error: "invalid signature" } };
          }
        } catch (e: any) {
          ctx.warn?.(`nylasWebhook: signature check error ${e?.message || e}`);
          return { status: 401, jsonBody: { ok: false, error: "signature check error" } };
        }
      } else {
        ctx.warn?.("nylasWebhook: NYLAS_WEBHOOK_SECRET not set; skipping signature verification");
      }

      let body: any = null;
      try { body = JSON.parse(raw); } catch { body = null; }
      if (!body) return bad("Missing JSON body");

      const events: any[] = Array.isArray(body) ? body : (Array.isArray(body?.notifications) ? body.notifications : [body]);
      let enqueued = 0;
      const windowSeconds = Number(process.env.WEBHOOK_DELTA_WINDOW_S || 3600);

      for (const evt of events) {
        const type: string = (evt?.type || evt?.trigger_type || "").toString();
        if (!type) continue;
        if (!type.startsWith("message.")) continue; // only handle message.* for now

        const data = evt?.data || evt;
        const grantId: string = (data?.grant_id || data?.grantId || "").toString();
        if (!grantId) continue;

        const sinceEpoch: number = Number(data?.date || data?.received_at || Math.floor(Date.now() / 1000) - windowSeconds);
        const max = Number(process.env.WEBHOOK_DELTA_MAX || 1000);

        await enqueueBackfill({ grantId, sinceEpoch, max, processed: 0, attempt: 0 });
        enqueued += 1;
      }

      ctx.log(`nylasWebhook: processed events=${events.length} enqueued=${enqueued}`);
      return accepted({ ok: true, received: events.length, enqueued });
    } catch (err: any) {
      ctx.error?.("nylasWebhook error", err);
      return { status: 500, jsonBody: { ok: false, error: err?.message || String(err) } };
    }
  },
});

