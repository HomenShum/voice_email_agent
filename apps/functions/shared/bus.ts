import { ServiceBusClient, ServiceBusMessage } from "@azure/service-bus";

export interface BackfillJob {
  grantId: string;
  sinceEpoch: number; // seconds since epoch
  max: number; // max messages to process
  pageToken?: string;
  attempt?: number; // exponential backoff attempt count
  processed?: number; // total processed so far
  jobId?: string; // optional tracking id for UI progress
}

const SB_CONNECTION = process.env.SERVICEBUS_CONNECTION;
export const BACKFILL_QUEUE = process.env.SB_QUEUE_BACKFILL || "nylas-backfill";

let _sbClient: ServiceBusClient | null = null;

function getClient(): ServiceBusClient {
  if (!_sbClient) {
    if (!SB_CONNECTION) throw new Error("SERVICEBUS_CONNECTION is not configured");
    _sbClient = new ServiceBusClient(SB_CONNECTION);
  }
  return _sbClient;
}

export async function enqueueBackfill(job: BackfillJob, delaySeconds = 0): Promise<void> {
  const client = getClient();
  const sender = client.createSender(BACKFILL_QUEUE);
  const message: ServiceBusMessage = {
    body: JSON.stringify(job),
    sessionId: job.grantId,
    contentType: "application/json",
  };

  if (delaySeconds > 0) {
    const when = new Date(Date.now() + Math.round(delaySeconds * 1000));
    await sender.scheduleMessages(message, when);
  } else {
    await sender.sendMessages(message);
  }
  await sender.close();
}

