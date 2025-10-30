import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { app } from "@azure/functions";
import { registerGrant } from "../shared/nylasConfig";
import { enqueueBackfill, BackfillJob } from "../shared/bus";
import { getCheckpoint, createJob, setGrantSecret } from "../shared/storage";

const NYLAS_BASE = process.env.NYLAS_BASE || "https://api.us.nylas.com/v3";
const MAX_DELTA_WINDOW = 10000;

function monthsAgoToEpochSeconds(months: number): number {
  const d = new Date();
  d.setMonth(d.getMonth() - Math.max(0, Math.floor(months)));
  return Math.floor(d.getTime() / 1000);
}

function clampDeltaMax(value: unknown): number {
  const raw = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(raw) || raw <= 0) return MAX_DELTA_WINDOW;
  return Math.min(Math.floor(raw), MAX_DELTA_WINDOW);
}

app.http("updateContext", {
  route: "user/update-context",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as Partial<{ nylasApiKey: string; grantId: string; months?: number; initialMax?: number; }>;
      const nylasApiKey = (body?.nylasApiKey || "").trim();
      const grantId = (body?.grantId || "").trim();
      if (!nylasApiKey || !grantId) {
        return { status: 400, jsonBody: { ok: false, error: "Missing nylasApiKey or grantId" } };
      }

      // 1) Validate credentials with Nylas: GET /v3/grants/{grantId}
      const url = `${NYLAS_BASE}/grants/${encodeURIComponent(grantId)}`;
      const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${nylasApiKey}`, Accept: "application/json" } });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        ctx.warn?.(`updateContext: grant validation failed ${res.status}: ${text}`);
        return { status: 401, jsonBody: { ok: false, error: "Invalid Nylas API Key or Grant ID" } };
      }

      // 2) Register grant for this runtime & persist secret for dev (in-memory + file)
      registerGrant(grantId, nylasApiKey);
      await setGrantSecret(grantId, nylasApiKey);

      // 3) Determine initial vs differential sync
      const cp = await getCheckpoint(grantId);
      const defaultMonths = Number(process.env.DELTA_DEFAULT_MONTHS || 12);
      const months = body?.months ?? defaultMonths;
      const sinceEpoch = cp > 0 ? cp : monthsAgoToEpochSeconds(months);
      const initial = cp <= 0;
      const initialMaxDefault = Number(process.env.BACKFILL_MAX || 10000);
      const max = initial
        ? clampDeltaMax(body?.initialMax ?? initialMaxDefault)
        : clampDeltaMax(process.env.DELTA_MAX);

      // 4) Create job record for UI progress
      const jobId = await createJob({ grantId, type: initial ? "backfill" : "delta", total: max, processed: 0 });

      // 5) Enqueue backfill job with tracking id
      const job: BackfillJob = { grantId, sinceEpoch, max, processed: 0, attempt: 0, jobId };
      await enqueueBackfill(job);

      ctx.log(`updateContext: enqueued ${initial ? "backfill" : "delta"} for grantId=${grantId} since=${sinceEpoch} max=${max} job=${jobId}`);

      return {
        status: 202,
        jsonBody: {
          ok: true,
          grantId,
          jobId,
          syncType: initial ? "initial" : "delta",
          sinceEpoch,
          max,
          estimatedMessages: max,
        },
      };
    } catch (err: any) {
      ctx.error?.("updateContext error", err);
      return { status: 500, jsonBody: { ok: false, error: err?.message || String(err) } };
    }
  },
});
