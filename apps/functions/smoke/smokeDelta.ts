import { enqueueBackfill, BackfillJob } from "../shared/bus";
import { getCheckpoint, setCheckpoint } from "../shared/storage";

async function main() {
  const grantId = process.env.NYLAS_GRANT_ID || process.env.GRANT_ID || "grant-smoke";

  // Set a fake checkpoint ~7 days ago if not present
  const existing = await getCheckpoint(grantId);
  let cp = existing;
  if (!cp || cp <= 0) {
    cp = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    await setCheckpoint(grantId, cp);
    console.log(`[SMOKE] Set checkpoint for grant=${grantId} to ${cp}`);
  } else {
    console.log(`[SMOKE] Using existing checkpoint for grant=${grantId}: ${cp}`);
  }

  // Enqueue delta job
  const max = Number(process.env.MAX || 50);
  const job: BackfillJob = { grantId, sinceEpoch: cp, max, processed: 0, attempt: 0 };
  console.log(`[SMOKE] Enqueue delta grant=${grantId} since=${cp} max=${max}`);
  await enqueueBackfill(job);
  console.log(`[SMOKE] Enqueued delta job`);
}

main().catch((e) => {
  console.error("[SMOKE] Error:", e);
  process.exitCode = 1;
});

