import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { app } from "@azure/functions";
import { enqueueBackfill, BackfillJob } from "../shared/bus.js";
import { getCheckpoint } from "../shared/storage.js";

const MAX_EMAIL_WINDOW = 10000;

function monthsAgoToEpochSeconds(months: number): number {
  const d = new Date();
  d.setMonth(d.getMonth() - Math.max(0, Math.floor(months)));
  return Math.floor(d.getTime() / 1000);
}

function parsePositiveNumber(value: unknown, fallback: number): number {
  const raw = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.floor(raw);
}

function resolveMaxEmails(requested: unknown): number {
  const configured = parsePositiveNumber(process.env.DELTA_MAX, MAX_EMAIL_WINDOW);
  const candidate = parsePositiveNumber(requested, configured);
  return Math.min(candidate, MAX_EMAIL_WINDOW);
}

app.http("deltaStart", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "sync/delta",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as Partial<{ grantId: string; months?: number; max?: number }>;
      const grantId = (body?.grantId || "").trim();
      if (!grantId) {
        return { status: 400, jsonBody: { ok: false, error: "Missing required grantId" } };
      }

      const defaultMonths = Number(process.env.DELTA_DEFAULT_MONTHS || 1);
      const months = body?.months ?? defaultMonths;
      const max = resolveMaxEmails(body?.max);

      const cp = await getCheckpoint(grantId);
      const sinceEpoch = cp > 0 ? cp : monthsAgoToEpochSeconds(months);

      const job: BackfillJob = { grantId, sinceEpoch, max, processed: 0, attempt: 0 };
      await enqueueBackfill(job);

      ctx.log(`Enqueued delta for grantId=${grantId} since=${sinceEpoch} max=${max} (cp=${cp}) window_limit=${MAX_EMAIL_WINDOW}`);
      return {
        status: 202,
        jsonBody: { ok: true, grantId, sinceEpoch, max, message: "Delta sync enqueued" },
      };
    } catch (err: any) {
      ctx.error?.("deltaStart error", err);
      return { status: 500, jsonBody: { ok: false, error: err?.message || String(err) } };
    }
  },
});
