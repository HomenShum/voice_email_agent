/*
Build per-thread weekly summaries from existing day notes and upsert to Pinecone.
Usage (PowerShell):
  node apps/functions/scripts/buildThreadWeek.js 22dd5c25-157e-4377-af23-e06602fdfcec 2025-W43
Optional filter by subject (regex via env):
  $env:SUBJECT_REGEX="OpenAI.*Berkeley"; node apps/functions/scripts/buildThreadWeek.js <grantId> <weekKey>
*/

(async () => {
  try {
    const [,, grantId, weekKey] = process.argv;
    if (!grantId || !weekKey) {
      console.error("Usage: node buildThreadWeek.js <grantId> <weekKey>");
      process.exit(2);
    }

    const storage = require("../dist/shared/storage.js");
    const openai = require("../dist/shared/openai.js");
    const pine = require("../dist/shared/pinecone.js");

    const dayKeys = await storage.listDayKeysForWeek(grantId, weekKey);
    if (!dayKeys.length) {
      console.error(`[thread_week] No day keys found for grant=${grantId} week=${weekKey}`);
      process.exit(1);
    }

    const notesAll = [];
    for (const dk of dayKeys) {
      const notes = await storage.loadDayNotes(grantId, dk);
      notesAll.push(...notes);
    }
    if (!notesAll.length) {
      console.error(`[thread_week] No notes found for grant=${grantId} week=${weekKey}`);
      process.exit(1);
    }

    const byThread = new Map();
    for (const n of notesAll) {
      const tid = String(n.thread_id || "");
      if (!tid) continue;
      const arr = byThread.get(tid) || [];
      arr.push(n);
      byThread.set(tid, arr);
    }

    let subjectRe = null;
    if (process.env.SUBJECT_REGEX) {
      try { subjectRe = new RegExp(process.env.SUBJECT_REGEX, "i"); } catch {}
    }

    let entries = Array.from(byThread.entries());
    if (subjectRe) {
      entries = entries.filter(([_, notes]) => notes.some(n => (n.subject || "").match(subjectRe)));
      console.log(`[thread_week] Subject filter active (${subjectRe}). Threads after filter: ${entries.length}`);
    } else {
      console.log(`[thread_week] Found ${entries.length} threads for week ${weekKey}`);
    }

    const dense = [];
    const sparse = [];
    for (const [threadId, notes] of entries) {
      if (!notes.length) continue;
      const subj = (notes.find(n => !!n.subject)?.subject || '').trim();
      const hint = `Weekly thread rollup for ${weekKey} (thread ${threadId})` +
        (subj ? `\nThread subject: ${subj}\nExplicitly preserve and mention proper names (e.g., OpenAI, Berkeley) and key entities present in the notes.` : '');
      const summary = await openai.summarizeNotes(notes, hint);
      const vec = await openai.embedText(summary);
      const id = `summary:thread_week:${threadId}:${weekKey}`;
      const metadata = {
        type: "thread_week",
        grant_id: grantId,
        bucket: weekKey,
        week_key: weekKey,
        thread_id: String(threadId),
        summary_scope: "thread_week",
        summary_text: summary,
      };
      dense.push({ id, values: vec, metadata });
      const sp = await pine.generateSparseEmbedding(summary, "passage");
      if (sp.indices?.length && sp.values?.length) {
        sparse.push({ id, metadata, sparseValues: sp });
      }
    }

    if (dense.length) {
      await pine.upsertDenseVectors(grantId, dense);
      console.log(`[thread_week] Upserted ${dense.length} dense vectors`);
    }
    if (sparse.length) {
      await pine.upsertSparseRecords(grantId, sparse);
      console.log(`[thread_week] Upserted ${sparse.length} sparse records`);
    }

    console.log(`[thread_week] Done for grant=${grantId} week=${weekKey}`);
  } catch (e) {
    console.error("[thread_week] Error:", e);
    process.exit(1);
  }
})();

