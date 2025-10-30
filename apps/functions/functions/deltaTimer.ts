import type { InvocationContext, Timer } from "@azure/functions";
import { app } from "@azure/functions";
import { enqueueBackfill } from "../shared/bus";
import { getCheckpoint, listKnownGrants, createJob } from "../shared/storage";
import { listRegisteredGrants } from "../shared/nylasConfig";

function monthsAgoToEpochSeconds(months: number): number {
  const d = new Date();
  d.setMonth(d.getMonth() - Math.max(0, Math.floor(months)));
  return Math.floor(d.getTime() / 1000);
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

const MAX_EMAIL_WINDOW = 10000;
const timerSchedule = process.env.DELTA_TIMER_SCHEDULE || "0 0 * * * *"; // top of every hour
const runOnStartup = process.env.DELTA_TIMER_RUN_ON_STARTUP === "1";
const resolvedMax = Math.min(
  MAX_EMAIL_WINDOW,
  parsePositiveNumber(process.env.DELTA_MAX, MAX_EMAIL_WINDOW)
);

if (process.env.SKIP_TIMER !== "1") app.timer("deltaTimer", {
  schedule: timerSchedule,
  runOnStartup,
  handler: async (timer: Timer, ctx: InvocationContext): Promise<void> => {
    const envGrant = (process.env.NYLAS_GRANT_ID || "").trim();
    const grantSet = new Set<string>();
    if (envGrant) grantSet.add(envGrant);
    for (const g of listRegisteredGrants()) {
      if (g) grantSet.add(g);
    }
    try {
      const known = await listKnownGrants();
      for (const g of known) {
        if (g) grantSet.add(g);
      }
    } catch {
      // ignore storage lookup errors; rely on env + registered grants
    }

    const grants = Array.from(grantSet);

    if (!grants.length) {
      ctx.warn?.("deltaTimer: no grants discovered; set NYLAS_GRANT_ID or create .data/grants/<grantId>");
      return;
    }

    const defaultMonths = Number(process.env.DELTA_DEFAULT_MONTHS || 1);
    const targetMax = resolvedMax;

    for (const grantId of grants) {
      try {
        const cp = await getCheckpoint(grantId);
        const sinceEpoch = cp > 0 ? cp : monthsAgoToEpochSeconds(defaultMonths);
        const jobId = await createJob({ grantId, type: "delta", total: targetMax, processed: 0 });
        await enqueueBackfill({ grantId, sinceEpoch, max: targetMax, processed: 0, attempt: 0, jobId });
        ctx.log(`deltaTimer: enqueued delta grantId=${grantId} job=${jobId} since=${sinceEpoch} (cp=${cp}) max=${targetMax} schedule=${timerSchedule}`);
      } catch (e: any) {
        ctx.error?.(`deltaTimer: failed to enqueue grantId=${grantId}: ${e?.message || e}`);
      }
    }
  },
});
