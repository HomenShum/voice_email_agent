import { app, InvocationContext } from "@azure/functions";
import { BackfillJob, enqueueBackfill } from "../shared/bus";
import { listMessages, NylasApiError, NylasMessage, downloadAttachment } from "../shared/nylas";
import { cleanText, embedText, summarizeNotes, analyzeImageBuffer, analyzePdfBuffer, summarizeLongTextMapReduce } from "../shared/openai";
import { upsertVectors } from "../shared/pinecone";
import { saveCleanText, saveAttachment, appendDayNote, loadDayNotes, saveSummary, setCheckpoint } from "../shared/storage";
import { dayKeyFromEpoch, weekKeyFromEpoch, monthKeyFromEpoch } from "../shared/shard";
import type { RecordMetadata } from "@pinecone-database/pinecone";


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

app.serviceBusQueue("backfillWorker", {
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
      const vectors: { id: string; values: number[]; metadata: RecordMetadata }[] = [];
      const dayKeysSeen = new Set<string>();

      const threadNotes = new Map<string, any[]>();

      let maxEpochPage = 0;
      for (const msg of messages as NylasMessage[]) {
        const epoch = msg.date || Math.floor(Date.now() / 1000);
        if (Number.isFinite(epoch)) maxEpochPage = Math.max(maxEpochPage, epoch);
        const dayKey = dayKeyFromEpoch(epoch);
        dayKeysSeen.add(dayKey);
        const dateIso = new Date(epoch * 1000).toISOString();
        let attachmentAnalyses: string[] = [];


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
                vectors.push({ id: `file:${msg.id}:${attId}`, values: vec, metadata: meta });
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
            date_created: dateIso,
            date: epoch,
            snippet: messageSummary.slice(0, 240),
            has_attachments: Array.isArray(msg.attachments) && msg.attachments.length > 0,
            unread: Boolean(msg.unread),
          } as unknown as RecordMetadata;
          vectors.push({ id, values: embedding, metadata });

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

      if (vectors.length) {
        await upsertVectors(job.grantId, vectors);
        ctx.log(`bf.upsert corr=${corr} count=${vectors.length}`);
      } else {
        ctx.log(`bf.skip corr=${corr} reason=empty_vectors`);
      }

      // Day/Week/Month summaries from notes of this page only (incremental)
      const summaryVectors: { id: string; values: number[]; metadata: RecordMetadata }[] = [];

      // Day summaries
      for (const dayKey of dayKeysSeen) {
        const notes = await loadDayNotes(job.grantId, dayKey);
        if (!notes.length) continue;
        const summary = await summarizeNotes(notes);
        await saveSummary(job.grantId, "day", dayKey, summary);

        const v = await embedText(summary);
        summaryVectors.push({
          id: `summary:day:${dayKey}`,
          values: v,
          metadata: { type: "thread_day", grant_id: job.grantId, bucket: dayKey, day_key: dayKey } as unknown as RecordMetadata,
        });


      }

      // Thread summaries (incremental from new/changed message-level summaries in this page)
      for (const [threadId, notes] of threadNotes) {
        if (!Array.isArray(notes) || !notes.length) continue;
        const tSummary = await summarizeNotes(notes as any[], `Thread rollup for ${threadId}`);
        await saveSummary(job.grantId, "thread", String(threadId), tSummary);
        const tVec = await embedText(tSummary);
        summaryVectors.push({
          id: `summary:thread:${threadId}`,
          values: tVec,
          metadata: { type: "thread", grant_id: job.grantId, thread_id: String(threadId) } as unknown as RecordMetadata,
        });
      }


      // Week summaries (from the days we touched)
      const weekMap = new Map<string, string[]>(); // weekKey -> dayKeys[]
      for (const dayKey of dayKeysSeen) {
        const weekKey = weekKeyFromEpoch(Math.floor(new Date(dayKey + "T00:00:00Z").getTime() / 1000));
        const arr = weekMap.get(weekKey) || [];
        arr.push(dayKey);
        weekMap.set(weekKey, arr);
      }
      for (const [weekKey, dayKeys] of weekMap) {
        const notesAll: any[] = [];
        for (const dk of dayKeys) {


          const n = await loadDayNotes(job.grantId, dk);
          notesAll.push(...n);
        }
        if (!notesAll.length) continue;
        const summary = await summarizeNotes(notesAll, `Weekly rollup for ${weekKey}`);
        await saveSummary(job.grantId, "week", weekKey, summary);
        const v = await embedText(summary);
        summaryVectors.push({
          id: `summary:week:${weekKey}`,
          values: v,
          metadata: { type: "thread_week", grant_id: job.grantId, bucket: weekKey, week_key: weekKey } as unknown as RecordMetadata,
        });
      }

      // Month summaries (from the days we touched)
      const monthMap = new Map<string, string[]>(); // monthKey -> dayKeys[]
      for (const dayKey of dayKeysSeen) {
        const monthKey = monthKeyFromEpoch(Math.floor(new Date(dayKey + "T00:00:00Z").getTime() / 1000));
        const arr = monthMap.get(monthKey) || [];
        arr.push(dayKey);
        monthMap.set(monthKey, arr);
      }
      for (const [monthKey, dayKeys] of monthMap) {
        const notesAll: any[] = [];
        for (const dk of dayKeys) {
          const n = await loadDayNotes(job.grantId, dk);
          notesAll.push(...n);
        }
        if (!notesAll.length) continue;
        const summary = await summarizeNotes(notesAll, `Monthly rollup for ${monthKey}`);
        await saveSummary(job.grantId, "month", monthKey, summary);
        const v = await embedText(summary);
        summaryVectors.push({
          id: `summary:month:${monthKey}`,
          values: v,
          metadata: { type: "thread_month", grant_id: job.grantId, bucket: monthKey, month_key: monthKey } as unknown as RecordMetadata,
        });
      }

      if (summaryVectors.length) {
        await upsertVectors(job.grantId, summaryVectors);
        ctx.log(`bf.upsert.summaries corr=${corr} count=${summaryVectors.length}`);
      }

      // Update checkpoint to the max message epoch seen on this page
      if (maxEpochPage > 0) {
        await setCheckpoint(job.grantId, maxEpochPage);
        ctx.log(`bf.checkpoint corr=${corr} epoch=${maxEpochPage}`);
      }

      const newProcessed = processedSoFar + messages.length;
      if (nextCursor && newProcessed < job.max) {
        const nextJob: BackfillJob = {
          grantId: job.grantId,
          sinceEpoch: job.sinceEpoch,
          max: job.max,
          pageToken: nextCursor,
          processed: newProcessed,
          attempt: 0,
        };
        await enqueueBackfill(nextJob, SMOOTH_DELAY_SECONDS);
        const tookMs = Date.now() - t0;
        ctx.log(`bf.enqueueNext corr=${job.grantId}:${nextCursor}:a0 processed=${newProcessed}/${job.max}`);
        ctx.log(`ai.metric page_processed grant=${job.grantId} messages=${messages.length} vectors=${vectors.length + summaryVectors.length} took_ms=${tookMs} next=${nextCursor}`);
      } else {
        const tookMs = Date.now() - t0;
        ctx.log(`bf.done corr=${corr} processed=${newProcessed}/${job.max} reason=${nextCursor ? "max_reached" : "no_more_pages"}`);
        ctx.log(`ai.metric page_processed grant=${job.grantId} messages=${messages.length} vectors=${vectors.length + summaryVectors.length} took_ms=${tookMs} next=-`);
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
      ctx.error?.(`bf.error corr=${corr} msg=${(err && err.message) || err}`);
      // Swallow error to avoid poison-loop; next page (if any) won't be scheduled here.
    }
  },
});

