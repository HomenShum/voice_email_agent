import crypto from "node:crypto";

async function main() {
  const webhookUrl = process.env.WEBHOOK_URL || "http://localhost:7071/api/webhooks/nylas";
  const secret = process.env.NYLAS_WEBHOOK_SECRET || "";
  const grantId = process.env.NYLAS_GRANT_ID || process.env.GRANT_ID || "grant-smoke";

  const payload = {
    type: "message.created",
    data: {
      grant_id: grantId,
      id: "msg-smoke-123",
      date: Math.floor(Date.now() / 1000)
    }
  };

  const body = JSON.stringify(payload);
  const signature = secret ? crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex") : "";

  console.log(`[SMOKE] Sending webhook to ${webhookUrl}`);
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(signature ? { "x-nylas-signature": signature } : {})
    },
    body,
  });

  const txt = await res.text();
  console.log(`[SMOKE] Status: ${res.status}`);
  console.log(`[SMOKE] Body: ${txt}`);
}

main().catch((e) => {
  console.error("[SMOKE] Error:", e);
  process.exitCode = 1;
});

