import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { enqueueBackfill, BackfillJob } from "../shared/bus";
import { getCheckpoint } from "../shared/storage";

function monthsAgoToEpochSeconds(months: number): number {
  const d = new Date();
  d.setMonth(d.getMonth() - Math.max(0, Math.floor(months)));
  return Math.floor(d.getTime() / 1000);
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
      const max = body?.max ?? Number(process.env.DELTA_MAX || 100000);

      const cp = await getCheckpoint(grantId);
      const sinceEpoch = cp > 0 ? cp : monthsAgoToEpochSeconds(months);

      const job: BackfillJob = { grantId, sinceEpoch, max, processed: 0, attempt: 0 };
      await enqueueBackfill(job);

      ctx.log(`Enqueued delta for grantId=${grantId} since=${sinceEpoch} max=${max} (cp=${cp})`);
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

