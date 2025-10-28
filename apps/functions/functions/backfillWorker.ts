import type { InvocationContext } from "@azure/functions";
import { BackfillJob, enqueueBackfill } from "../shared/bus";
import { listMessages, NylasApiError, NylasMessage, downloadAttachment } from "../shared/nylas";
import { cleanText, embedText, summarizeNotes, analyzeImageBuffer, analyzePdfBuffer, analyzeAttachmentBuffer, summarizeLongTextMapReduce } from "../shared/openai";
import { upsertDenseVectors, upsertSparseRecords, generateSparseEmbedding, flushIndexSessionMetricsNow } from "../shared/pinecone";
import { saveCleanText, saveAttachment, appendDayNote, loadDayNotes, saveSummary, setCheckpoint, updateJob, getJob, listDayKeysForWeek, listDayKeysForMonth } from "../shared/storage";
import { dayKeyFromEpoch, weekKeyFromEpoch, monthKeyFromEpoch } from "../shared/shard";
import type { RecordMetadata } from "@pinecone-database/pinecone";
import type { VectorRecord, SparseRecord } from "../shared/pinecone";


const BACKOFF_SECONDS = [10, 20, 40, 80, 160, 300] as const; // max 6 attempts
const SMOOTH_DELAY_SECONDS = 0.2; // 200ms between pages

function parseJob(raw: unknown): BackfillJob {
  if (typeof raw === "string") return JSON.parse(raw) as BackfillJob;
  return raw as BackfillJob;
}

function toFirstEmails(addrs?: { email: string }[], max = 3): string[] {
  if (!addrs || !Array.isArray(addrs)) return [];
  return addrs.map(a => a?.email).filter(Boolean).slice(0, max) as string[];
}

function toAllEmails(addrs?: { email: string }[]): string[] {
  if (!addrs || !Array.isArray(addrs) || !addrs.length) return [];
  const seen = new Set<string>();
  for (const addr of addrs) {
    const email = (addr?.email || "").trim();
    if (email) seen.add(email.toLowerCase());
  }
  return Array.from(seen);
}

// Load the real @azure/functions at runtime, avoiding any local test stub under dist/node_modules
function loadAzureFunctionsRuntime(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("path");
  const realDir = path.resolve(process.cwd(), "node_modules", "@azure", "functions");
  try {
    // Prefer the real installed package under apps/functions/node_modules
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(realDir);
    return mod;
  } catch {
    // Fallback to default resolution (may hit stub if running tests)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("@azure/functions");
  }
}

// Resilient registration to handle environments where app.serviceBusQueue may be unavailable
function registerServiceBusQueue(
  name: string,
  options: { handler: (message: unknown, ctx: InvocationContext) => Promise<void> } & Record<string, any>
) {
  const azf = loadAzureFunctionsRuntime();
  const appAny = azf?.app as any;
  const trigAny = azf?.trigger as any;
  const svc = appAny?.serviceBusQueue;
  if (typeof svc === "function") return svc(name, options);
  // Fallback to generic + trigger API if direct helper is not available
  const { handler, ...triggerOpts } = options;
  const trig = trigAny?.serviceBusQueue?.(triggerOpts);
  if (trig && typeof appAny?.generic === "function") {
    return appAny.generic(name, { trigger: trig, handler });
  }
  throw new Error("Azure Functions Service Bus registration helpers not available in this runtime");
}

if (process.env.DEBUG_FUNC_REG) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require("path");
    const mod = loadAzureFunctionsRuntime();
    // eslint-disable-next-line no-console
    console.log(
      "azf_resolve=",
      (mod && mod.__esModule && (mod as any).default) ? "(esm)" : path.resolve(process.cwd(), "node_modules", "@azure", "functions"),
      " has_app=",
      !!mod?.app,
      " has_sbq=",
      !!mod?.app?.serviceBusQueue,
      " has_trigger=",
      !!mod?.trigger?.serviceBusQueue,
      " has_generic=",
      !!mod?.app?.generic
    );
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.log("azf_require_error=", e?.message || e);
  }
}

registerServiceBusQueue("backfillWorker", {
  connection: "SERVICEBUS_CONNECTION",
  queueName: process.env.SB_QUEUE_BACKFILL || "nylas-backfill",
  isSessionsEnabled: true,
  handler: async (message: unknown, ctx: InvocationContext): Promise<void> => {
    const job = parseJob(message);
    const attempt = job.attempt ?? 0;
    const processedSoFar = job.processed ?? 0;
    const corr = `${job.grantId}:${job.pageToken || "start"}:a${attempt}`;
    const t0 = Date.now();

    try {
      ctx.log(`bf.start corr=${corr} processed=${processedSoFar} max=${job.max}`);

      const { messages, nextCursor } = await listMessages({
        grantId: job.grantId,
        sinceEpoch: job.sinceEpoch,
        pageToken: job.pageToken,
        limit: 200,
      });
      ctx.log(`bf.page corr=${corr} messages=${messages.length} next=${nextCursor || "-"}`);

      // Prepare vectors + storage + day notes
      const denseVectors: VectorRecord[] = [];
      const sparseRecords: SparseRecord[] = [];
      const dayKeysSeen = new Set<string>();

      const threadNotes = new Map<string, any[]>();

      let maxEpochPage = 0;
      for (const msg of messages as NylasMessage[]) {
        const epoch = msg.date || Math.floor(Date.now() / 1000);
        if (Number.isFinite(epoch)) maxEpochPage = Math.max(maxEpochPage, epoch);
        const dayKey = dayKeyFromEpoch(epoch);
        const weekKey = weekKeyFromEpoch(epoch);
        const monthKey = monthKeyFromEpoch(epoch);
        dayKeysSeen.add(dayKey);
        const dateIso = new Date(epoch * 1000).toISOString();
        let attachmentAnalyses: string[] = [];
        let attachmentCount = 0;
        const attachmentTypes = new Set<string>();


        const text = cleanText(msg.body || "");
        if (text) {
          await saveCleanText(job.grantId, msg.id, text);
        }

        // Attachments
        if (Array.isArray(msg.attachments) && msg.attachments.length) {
          for (const a of msg.attachments) {
            // Some Nylas payloads include id/content_type/filename
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const att: any = a as any;
            const attId: string = att?.id || att?.attachment_id || "";
            if (!attId) continue;
            try {
              const { content, contentType, filename } = await downloadAttachment(job.grantId, msg.id, attId);
              const fname = filename || `${attId}`;
              await saveAttachment(job.grantId, msg.id, fname, content, contentType);

              let analysis: string | null = null;
              if (contentType?.startsWith("image/")) {
                analysis = await analyzeImageBuffer(content, contentType, fname);
              } else if (contentType === "application/pdf") {
                analysis = await analyzePdfBuffer(content, fname);
              } else {
                analysis = await analyzeAttachmentBuffer(content, {
                  filename: fname,
                  contentType,
                });
              }

              if (analysis) {
                // Collect for inclusion in message-level summary
                attachmentAnalyses.push(`Attachment "${fname}": ${analysis}`);
                const vec = await embedText(analysis);
                const meta: RecordMetadata = {
                  type: "attachment_file",
                  grant_id: job.grantId,
                  message_id: msg.id,
                  thread_id: msg.thread_id || "",
                  filename: fname,
                  content_type: contentType || "",
                  date_created: dateIso,
                  date: epoch,
                } as unknown as RecordMetadata;
                denseVectors.push({ id: `file:${msg.id}:${attId}`, values: vec, metadata: meta });
                const sparseEmbedding = await generateSparseEmbedding(analysis, "passage");
                if (sparseEmbedding.indices.length && sparseEmbedding.values.length) {
                  sparseRecords.push({
                    id: `file:${msg.id}:${attId}`,
                    metadata: meta,
                    sparseValues: sparseEmbedding,
                  });
                } else {
                  sparseRecords.push({
                    id: `file:${msg.id}:${attId}`,
                    metadata: meta,
                    text: analysis,
                  });
                }
              }
              attachmentCount += 1;
              if (contentType) {
                attachmentTypes.add(contentType.toLowerCase());
              }
            } catch (e: any) {
              ctx.warn?.(`bf.attach.fail corr=${corr} msg_id=${msg.id} att=${attId} err=${e?.message || e}`);
            }
          }
        }
        // Build message-level summary (map-reduce over body + attachment analyses), then embed
        const fromEmail = (msg.from && msg.from[0]?.email) || "";
        const fromDomain = (fromEmail.match(/@([^> ]+)/)?.[1] || "").toLowerCase();
        const combinedForSummary = [
          text || "",
          attachmentAnalyses.length ? ("\n\n" + attachmentAnalyses.join("\n")) : "",
        ].join("");

        const labelNames = Array.isArray(msg.labels)
          ? msg.labels.map(l => (l?.name || "").toLowerCase()).filter(Boolean)
          : [];
        const folderName = (msg.folder?.name || "").toLowerCase() || undefined;
        const ccList = toFirstEmails(msg.cc, 5);
        const bccList = toFirstEmails(msg.bcc, 5);
        const participants = new Set<string>();
        for (const email of [
          ...toAllEmails(msg.from),
          ...toAllEmails(msg.to),
          ...toAllEmails(msg.cc),
          ...toAllEmails(msg.bcc),
        ]) {
          participants.add(email);
        }

        if (combinedForSummary.trim().length) {
          const hint = `Message summary for subject: ${msg.subject || "(no subject)"}`;
          const messageSummary = await summarizeLongTextMapReduce(combinedForSummary, hint);


          const embedding = await embedText(messageSummary);
          const id = `msg:${msg.id}`;
          const metadata: RecordMetadata = {
            type: "message",
            grant_id: job.grantId,
            thread_id: msg.thread_id || "",
            subject: msg.subject || "",
            from: fromEmail,
            from_domain: fromDomain,
            to: toFirstEmails(msg.to, 3),
            cc: ccList,
            bcc: bccList,
            participants: Array.from(participants),
            date_created: dateIso,
            date: epoch,
            day_key: dayKey,
            week_key: weekKey,
            month_key: monthKey,
            snippet: messageSummary.slice(0, 240),
            has_attachments: Array.isArray(msg.attachments) && msg.attachments.length > 0,
            attachment_count: attachmentCount,
            attachment_types: attachmentTypes.size ? Array.from(attachmentTypes) : [],
            unread: Boolean(msg.unread),
            starred: Boolean(msg.starred),
            ...(typeof msg.size === "number" ? { size: msg.size } : {}),
            labels: labelNames,
            folder: folderName,
          } as unknown as RecordMetadata;
          denseVectors.push({ id, values: embedding, metadata });
          const messageSparse = await generateSparseEmbedding(messageSummary, "passage");
          if (messageSparse.indices.length && messageSparse.values.length) {
            sparseRecords.push({ id, metadata, sparseValues: messageSparse });
          } else {
            sparseRecords.push({ id, metadata, text: messageSummary });
          }

          // Append to day note using the summary excerpt
          await appendDayNote(job.grantId, msg.thread_id, dayKey, {
            messageId: msg.id,
            date_iso: dateIso,
            from: fromEmail,
            to: toFirstEmails(msg.to, 5),
            subject: msg.subject || "",
            excerpt: messageSummary.slice(0, 240),
          });

          // Accumulate thread-level notes for incremental thread summary
          if (msg.thread_id) {
            const arr = threadNotes.get(msg.thread_id) || [];
            arr.push({ date_iso: dateIso, subject: msg.subject || "", from: fromEmail, to: toFirstEmails(msg.to, 3), excerpt: messageSummary.slice(0, 240) });
            threadNotes.set(msg.thread_id, arr);
          }
        }

      }

      if (denseVectors.length) {
        await upsertDenseVectors(job.grantId, denseVectors);
        await upsertSparseRecords(job.grantId, sparseRecords);
        ctx.log(
          `bf.upsert corr=${corr} dense=${denseVectors.length} sparse=${sparseRecords.length}`
        );
        // Persist metrics snapshot after main upserts
        try { flushIndexSessionMetricsNow(); } catch {}

      } else {
        ctx.log(`bf.skip corr=${corr} reason=empty_vectors`);
      }

      // Day/Week/Month summaries from notes of this page only (incremental)
      const summaryDenseVectors: VectorRecord[] = [];
      const summarySparseRecords: SparseRecord[] = [];

      // Day summaries
      for (const dayKey of dayKeysSeen) {
        const notes = await loadDayNotes(job.grantId, dayKey);
        if (!notes.length) continue;
        const summary = await summarizeNotes(notes);
        await saveSummary(job.grantId, "day", dayKey, summary);

        const v = await embedText(summary);
        const metadata: RecordMetadata = {
          type: "thread_day",
          grant_id: job.grantId,
          bucket: dayKey,
          day_key: dayKey,
          summary_scope: "day",
          summary_text: summary,
        } as unknown as RecordMetadata;
        summaryDenseVectors.push({
          id: `summary:day:${dayKey}`,
          values: v,
          metadata,
        });
        const sparse = await generateSparseEmbedding(summary, "passage");
        if (sparse.indices.length && sparse.values.length) {
          summarySparseRecords.push({
            id: `summary:day:${dayKey}`,
            metadata,
            sparseValues: sparse,
          });
        } else {
          summarySparseRecords.push({
            id: `summary:day:${dayKey}`,
            metadata,
            text: summary,
          });
        }
      }

      // Thread summaries (incremental from new/changed message-level summaries in this page)
      for (const [threadId, notes] of threadNotes) {
        if (!Array.isArray(notes) || !notes.length) continue;
        const tSummary = await summarizeNotes(notes as any[], `Thread rollup for ${threadId}`);
        await saveSummary(job.grantId, "thread", String(threadId), tSummary);
        const tVec = await embedText(tSummary);
        const metadata: RecordMetadata = {
          type: "thread",
          grant_id: job.grantId,
          thread_id: String(threadId),
          summary_scope: "thread",
          summary_text: tSummary,
        } as unknown as RecordMetadata;
        summaryDenseVectors.push({
          id: `summary:thread:${threadId}`,
          values: tVec,
          metadata,
        });
        const sparse = await generateSparseEmbedding(tSummary, "passage");
        if (sparse.indices.length && sparse.values.length) {
          summarySparseRecords.push({
            id: `summary:thread:${threadId}`,
            metadata,
            sparseValues: sparse,
          });
        } else {
          summarySparseRecords.push({
            id: `summary:thread:${threadId}`,
            metadata,
            text: tSummary,
          });
        }
      }


      // Week summaries (full-week re-summarization for any touched week)
      const weekTouched = new Set<string>();
      for (const dayKey of dayKeysSeen) {
        const wk = weekKeyFromEpoch(Math.floor(new Date(dayKey + "T00:00:00Z").getTime() / 1000));
        weekTouched.add(wk);
      }
      for (const weekKey of weekTouched) {
        const weekDays = await listDayKeysForWeek(job.grantId, weekKey);
        const notesAll: any[] = [];
        for (const dk of weekDays) {
          const n = await loadDayNotes(job.grantId, dk);
          notesAll.push(...n);
        }
        if (!notesAll.length) continue;
        const summary = await summarizeNotes(notesAll, `Weekly rollup for ${weekKey}`);
        await saveSummary(job.grantId, "week", weekKey, summary);
        const v = await embedText(summary);
        const metadata: RecordMetadata = {
          type: "summary_week",
          grant_id: job.grantId,
          bucket: weekKey,
          week_key: weekKey,
          summary_scope: "week",
          summary_text: summary,
        } as unknown as RecordMetadata;
        summaryDenseVectors.push({ id: `summary:week:${weekKey}`, values: v, metadata });
        const sparse = await generateSparseEmbedding(summary, "passage");
        if (sparse.indices.length && sparse.values.length) {
          summarySparseRecords.push({ id: `summary:week:${weekKey}`, metadata, sparseValues: sparse });
        } else {

        // Per-thread weekly summaries within this week
        const byThread = new Map<string, any[]>();
        for (const n of notesAll) {
          const tid = String((n as any).thread_id || "");
          if (!tid) continue;
          const arr = byThread.get(tid) || [];
          arr.push(n);
          byThread.set(tid, arr);
        }
        for (const [threadId, notes] of byThread) {
          if (!notes.length) continue;
          const tSummary = await summarizeNotes(notes as any[], `Weekly thread rollup for ${weekKey} (thread ${threadId})`);
          await saveSummary(job.grantId, "thread", `${threadId}@${weekKey}`, tSummary);
          const tVec = await embedText(tSummary);
          const tMeta: RecordMetadata = {
            type: "thread_week",
            grant_id: job.grantId,
            bucket: weekKey,
            week_key: weekKey,
            thread_id: String(threadId),
            summary_scope: "thread_week",
            summary_text: tSummary,
          } as unknown as RecordMetadata;
          const tid = `summary:thread_week:${threadId}:${weekKey}`;
          summaryDenseVectors.push({ id: tid, values: tVec, metadata: tMeta });
          const tSparse = await generateSparseEmbedding(tSummary, "passage");
          if (tSparse.indices.length && tSparse.values.length) {
            summarySparseRecords.push({ id: tid, metadata: tMeta, sparseValues: tSparse });
          }
        }
          summarySparseRecords.push({ id: `summary:week:${weekKey}`, metadata, text: summary });
        }
      }

      // Month summaries (full-month re-summarization for any touched month)
      const monthTouched = new Set<string>();
      for (const dayKey of dayKeysSeen) {
        const mk = monthKeyFromEpoch(Math.floor(new Date(dayKey + "T00:00:00Z").getTime() / 1000));
        monthTouched.add(mk);
      }
      for (const monthKey of monthTouched) {
        const monthDays = await listDayKeysForMonth(job.grantId, monthKey);
        const notesAll: any[] = [];
        for (const dk of monthDays) {
          const n = await loadDayNotes(job.grantId, dk);
          notesAll.push(...n);
        }
        if (!notesAll.length) continue;
        const summary = await summarizeNotes(notesAll, `Monthly rollup for ${monthKey}`);
        await saveSummary(job.grantId, "month", monthKey, summary);
        const v = await embedText(summary);
        const metadata: RecordMetadata = {
          type: "thread_month",
          grant_id: job.grantId,
          bucket: monthKey,
          month_key: monthKey,
          summary_scope: "month",
          summary_text: summary,
        } as unknown as RecordMetadata;
        summaryDenseVectors.push({ id: `summary:month:${monthKey}`, values: v, metadata });
        const sparse = await generateSparseEmbedding(summary, "passage");
        if (sparse.indices.length && sparse.values.length) {
          summarySparseRecords.push({ id: `summary:month:${monthKey}`, metadata, sparseValues: sparse });
        } else {
          summarySparseRecords.push({ id: `summary:month:${monthKey}`, metadata, text: summary });
        }
      }

      if (summaryDenseVectors.length) {
        await upsertDenseVectors(job.grantId, summaryDenseVectors);
        await upsertSparseRecords(job.grantId, summarySparseRecords);
        ctx.log(`bf.upsert.summaries corr=${corr} dense=${summaryDenseVectors.length} sparse=${summarySparseRecords.length}`);
        // Persist metrics snapshot after summary upserts
        try { flushIndexSessionMetricsNow(); } catch {}
      }

      // Update checkpoint to the max message epoch seen on this page
      if (maxEpochPage > 0) {
        await setCheckpoint(job.grantId, maxEpochPage);
        ctx.log(`bf.checkpoint corr=${corr} epoch=${maxEpochPage}`);
      }

      const newProcessed = processedSoFar + messages.length;
      // Update job progress (best-effort)
      const pageVectors = denseVectors.length + summaryDenseVectors.length;
      if (job.jobId) {
        const cur = await getJob(job.jobId);
        const prev = (cur && typeof cur.indexedVectors === "number") ? cur.indexedVectors : 0;
        await updateJob(job.jobId, { status: "running", processed: newProcessed, indexedVectors: prev + pageVectors });
      }
      if (nextCursor && newProcessed < job.max) {
        const nextJob: BackfillJob = {
          grantId: job.grantId,
          sinceEpoch: job.sinceEpoch,
          max: job.max,
          pageToken: nextCursor,
          processed: newProcessed,
          attempt: 0,
          jobId: job.jobId,
        };
        await enqueueBackfill(nextJob, SMOOTH_DELAY_SECONDS);
        const tookMs = Date.now() - t0;
        ctx.log(`bf.enqueueNext corr=${job.grantId}:${nextCursor}:a0 processed=${newProcessed}/${job.max}`);
        ctx.log(`ai.metric page_processed grant=${job.grantId} messages=${messages.length} vectors=${denseVectors.length + summaryDenseVectors.length} took_ms=${tookMs} next=${nextCursor}`);
      } else {
        const tookMs = Date.now() - t0;
        ctx.log(`bf.done corr=${corr} processed=${newProcessed}/${job.max} reason=${nextCursor ? "max_reached" : "no_more_pages"}`);
        ctx.log(`ai.metric page_processed grant=${job.grantId} messages=${messages.length} vectors=${denseVectors.length + summaryDenseVectors.length} took_ms=${tookMs} next=-`);
        // Mark job complete with last sync timestamp
        if (job.jobId) {
          const lastTs = maxEpochPage > 0 ? new Date(maxEpochPage * 1000).toISOString() : new Date().toISOString();
          const cur = await getJob(job.jobId);
          const iv = (cur && typeof cur.indexedVectors === "number") ? cur.indexedVectors : 0;
          await updateJob(job.jobId, { status: "complete", processed: newProcessed, lastSyncTimestamp: lastTs, message: `Completed: ${newProcessed} messages, ${iv} vectors` });
        }
      }
    } catch (err: any) {
      if (err instanceof NylasApiError && (err.status === 429 || err.status === 504)) {
        const idx = Math.min(attempt, BACKOFF_SECONDS.length - 1);
        const delay = BACKOFF_SECONDS[idx];
        if (attempt >= BACKOFF_SECONDS.length) {
          ctx.error?.(`bf.fail corr=${corr} reason=rate_limited_exhausted attempts=${attempt}`);
          return;
        }
        const retryJob: BackfillJob = { ...job, attempt: attempt + 1 };
        await enqueueBackfill(retryJob, delay);
        ctx.log(`bf.retry corr=${corr} delay_s=${delay} status=${err.status}`);
        return;
      }
      if (err instanceof NylasApiError && (err.status === 401 || err.status === 403)) {
        ctx.error?.(`[bf.auth] corr=${corr} grant=${job.grantId} status=${err.status} reason=nylas_unauthorized`);
        ctx.log?.(`ai.metric nylas_unauthorized grant=${job.grantId} status=${err.status}`);
        if (job.jobId) {
          await updateJob(job.jobId, {
            status: "error",
            message: `Nylas unauthorized (${err.status}). Verify NYLAS_KEY_<grant> or NYLAS_API_KEY for grant ${job.grantId}.`,
          });
        }
        return;
      }
      ctx.error?.(`bf.error corr=${corr} msg=${(err && err.message) || err}`);
      // Update job status on error (best-effort)
      if (job.jobId) {
        await updateJob(job.jobId, { status: "error", message: (err && err.message) || String(err) });
      }
      // Swallow error to avoid poison-loop; next page (if any) won't be scheduled here.
    }
  },
});
