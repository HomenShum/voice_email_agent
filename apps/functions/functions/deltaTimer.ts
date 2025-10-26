import { app, InvocationContext, Timer } from "@azure/functions";
import { enqueueBackfill } from "../shared/bus";
import { getCheckpoint, listKnownGrants } from "../shared/storage";

function monthsAgoToEpochSeconds(months: number): number {
  const d = new Date();
  d.setMonth(d.getMonth() - Math.max(0, Math.floor(months)));
  return Math.floor(d.getTime() / 1000);
}

app.timer("deltaTimer", {
  schedule: "0 0 * * * *", // top of every hour
  handler: async (timer: Timer, ctx: InvocationContext): Promise<void> => {
    const envGrant = (process.env.NYLAS_GRANT_ID || "").trim();
    let grants: string[] = [];
    try {
      const known = await listKnownGrants();
      grants = known.length ? known : (envGrant ? [envGrant] : []);
    } catch {
      grants = envGrant ? [envGrant] : [];
    }

    if (!grants.length) {
      ctx.warn?.("deltaTimer: no grants discovered; set NYLAS_GRANT_ID or create .data/grants/<grantId>");
      return;
    }

    const defaultMonths = Number(process.env.DELTA_DEFAULT_MONTHS || 1);
    const defaultMax = Number(process.env.DELTA_MAX || 100000);

    for (const grantId of grants) {
      try {
        const cp = await getCheckpoint(grantId);
        const sinceEpoch = cp > 0 ? cp : monthsAgoToEpochSeconds(defaultMonths);
        await enqueueBackfill({ grantId, sinceEpoch, max: defaultMax, processed: 0, attempt: 0 });
        ctx.log(`deltaTimer: enqueued delta grantId=${grantId} since=${sinceEpoch} (cp=${cp}) max=${defaultMax}`);
      } catch (e: any) {
        ctx.error?.(`deltaTimer: failed to enqueue grantId=${grantId}: ${e?.message || e}`);
      }
    }
  },
});

