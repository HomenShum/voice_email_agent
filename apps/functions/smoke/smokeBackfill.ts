import { enqueueBackfill, BackfillJob } from "../shared/bus.js";

async function main() {
  const grantId = process.env.NYLAS_GRANT_ID || process.env.GRANT_ID || "grant-smoke";
  const months = Number(process.env.MONTHS || 1);
  const max = Number(process.env.MAX || 50);

  const sinceEpoch = Math.floor(Date.now() / 1000) - months * 30 * 24 * 3600;
  const job: BackfillJob = { grantId, sinceEpoch, max, processed: 0, attempt: 0 };
  console.log(`[SMOKE] Enqueue backfill grant=${grantId} months=${months} max=${max}`);
  await enqueueBackfill(job);
  console.log(`[SMOKE] Enqueued initial backfill job`);
}

main().catch((e) => {
  console.error("[SMOKE] Error:", e);
  process.exitCode = 1;
});
