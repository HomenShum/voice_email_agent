export interface NylasEmailAddress {
  email: string;
  name?: string | null;
}

export interface NylasAttachmentRef {
  id: string;
  filename?: string;
}

export interface NylasMessage {
  id: string;
  thread_id?: string;
  subject?: string | null;
  from?: NylasEmailAddress[];
  to?: NylasEmailAddress[];
  cc?: NylasEmailAddress[];
  bcc?: NylasEmailAddress[];
  date?: number; // seconds since epoch
  unread?: boolean;
  starred?: boolean;
  size?: number;
  labels?: { id?: string; name?: string | null }[];
  folder?: { id?: string; name?: string | null } | null;
  attachments?: NylasAttachmentRef[];
  body?: string | null;
}

export class NylasApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "NylasApiError";
  }
}

import { getApiKeyForGrant } from "./nylasConfig.js";

const NYLAS_BASE = process.env.NYLAS_BASE || "https://api.us.nylas.com/v3";

export interface ListMessagesParams {
  grantId: string;
  sinceEpoch: number; // seconds
  pageToken?: string;
  limit?: number; // default 200
}

export interface ListMessagesResult {
  messages: NylasMessage[];
  nextCursor?: string;
}

export async function listMessages(params: ListMessagesParams): Promise<ListMessagesResult> {
  const { grantId, sinceEpoch, pageToken, limit = 200 } = params;

  // Smoke-testable mock mode to simulate pagination without calling Nylas
  if (process.env.NYLAS_MOCK === "1") {
    const pageMap: Record<string, { count: number; next?: string }> = {
      start: { count: 5, next: "p2" },
      p2: { count: 5, next: "p3" },
      p3: { count: 2 },
    };
    const key = pageToken || "start";
    const { count, next } = pageMap[key] || { count: 0 };
    const n = Math.min(limit, count);
    const nowSec = Math.floor(Date.now() / 1000);
    const makeMsg = (i: number): NylasMessage => ({
      id: `${key}-${i}`,
      thread_id: `t-${key}`,
      subject: `Mock subject ${key} #${i}`,
      from: [{ email: `from-${i}@example.com` }],
      to: [{ email: `to-${i}@example.com` }],
      date: nowSec - i * 60,
      unread: i % 2 === 0,
      attachments: [],
      body: `Hello from ${key} index ${i}. since=${sinceEpoch}`,
    });
    return { messages: Array.from({ length: n }, (_, i) => makeMsg(i)), nextCursor: next };
  }

  const apiKey = getApiKeyForGrant(grantId);

  const url = new URL(`${NYLAS_BASE}/grants/${encodeURIComponent(grantId)}/messages`);
  url.searchParams.set("limit", String(Math.min(limit, 200)));
  url.searchParams.set(
    "select",
    [
      "id",
      "thread_id",
      "subject",
      "from",
      "to",
      "cc",
      "bcc",
      "date",
      "unread",
      "starred",
      "size",
      "labels",
      "folder",
      "attachments",
      "body",
    ].join(",")
  );
  url.searchParams.set("received_after", String(Math.floor(sinceEpoch)));
  if (pageToken) url.searchParams.set("page_token", pageToken);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json, application/gzip", // prefer JSON, allow gzip
    },
  });

  if (res.status === 429 || res.status === 504) {
    throw new NylasApiError(`Nylas transient error: ${res.status}`, res.status);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new NylasApiError(`Nylas API error ${res.status}: ${text}`, res.status);
  }

  const data = await res.json();
  const messages: NylasMessage[] = Array.isArray(data?.data) ? data.data : [];
  const nextCursor: string | undefined = data?.next_cursor || data?.next || undefined;
  return { messages, nextCursor };
}



export async function downloadAttachment(
  grantId: string,
  messageId: string,
  attachmentId: string
): Promise<{ content: Buffer; contentType?: string; filename?: string }> {
  // Mock mode returns a small buffer
  if (process.env.NYLAS_MOCK === "1") {
    return { content: Buffer.from("mock-attachment"), contentType: "application/octet-stream", filename: `${attachmentId}.bin` };
  }
  
  const apiKey = getApiKeyForGrant(grantId);

  // 1) Metadata
  const metaUrl = new URL(
    `${NYLAS_BASE}/grants/${encodeURIComponent(grantId)}/attachments/${encodeURIComponent(attachmentId)}`
  );
  metaUrl.searchParams.set("message_id", messageId);
  const metaRes = await fetch(metaUrl.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json, application/gzip" },
  });
  if (!metaRes.ok) {
    const t = await metaRes.text().catch(() => "");
    throw new NylasApiError(`Nylas attachment meta error ${metaRes.status}: ${t}`, metaRes.status);
  }
  const meta = await metaRes.json().catch(() => ({} as any));
  const data = meta?.data ?? {};
  const filename: string | undefined = data?.filename;
  const contentType: string | undefined = data?.content_type;

  // 2) Download
  const dlUrl = new URL(
    `${NYLAS_BASE}/grants/${encodeURIComponent(grantId)}/attachments/${encodeURIComponent(attachmentId)}/download`
  );
  dlUrl.searchParams.set("message_id", messageId);
  const dlRes = await fetch(dlUrl.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!dlRes.ok) {
    const t = await dlRes.text().catch(() => "");
    throw new NylasApiError(`Nylas attachment download error ${dlRes.status}: ${t}`, dlRes.status);
  }
  const arr = await dlRes.arrayBuffer();
  const content = Buffer.from(arr);
  return { content, contentType, filename };
}
