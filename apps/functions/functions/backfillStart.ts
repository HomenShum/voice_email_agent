import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { enqueueBackfill, BackfillJob } from "../shared/bus";

function monthsAgoToEpochSeconds(months: number): number {
  const d = new Date();
  d.setMonth(d.getMonth() - Math.max(0, Math.floor(months)));
  return Math.floor(d.getTime() / 1000);
}

app.http("backfillStart", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "sync/backfill",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as Partial<{ grantId: string; months?: number; max?: number }>;
      const grantId = (body?.grantId || "").trim();
      if (!grantId) {
        return { status: 400, jsonBody: { ok: false, error: "Missing required grantId" } };
      }
      const months = body?.months ?? 12;
      const max = body?.max ?? 10000;
      const sinceEpoch = monthsAgoToEpochSeconds(months);

      const job: BackfillJob = { grantId, sinceEpoch, max, processed: 0, attempt: 0 };
      await enqueueBackfill(job);

      ctx.log(`Enqueued backfill for grantId=${grantId} since=${sinceEpoch} max=${max}`);
      return {
        status: 202,
        jsonBody: { ok: true, grantId, sinceEpoch, max, message: "Backfill enqueued" },
      };
    } catch (err: any) {
      ctx.error?.("backfillStart error", err);
      return { status: 500, jsonBody: { ok: false, error: err?.message || String(err) } };
    }
  },
});

