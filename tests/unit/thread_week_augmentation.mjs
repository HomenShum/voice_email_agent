import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const FUNCTIONS_BASE = process.env.FUNCTIONS_BASE || 'http://localhost:7073';
const GRANT_ID = process.env.NYLAS_GRANT_ID || '22dd5c25-157e-4377-af23-e06602fdfcec';

async function postJSON(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

function tryReadThreadWeekFile(grantId, threadId, weekKey) {
  const p = path.resolve(
    process.cwd(),
    'apps/functions/.data/grants',
    grantId,
    'summaries/thread',
    `${threadId}@${weekKey}.txt`
  );
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf-8');
}

function assert(condition, msg) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

(async () => {
  try {
    const res = await postJSON(`${FUNCTIONS_BASE}/api/search`, {
      grantId: GRANT_ID,
      query: 'OpenAI UC Berkeley weekly summary',
      types: ['thread_week'],
      topK: 5,
    });

    const matches = res.matches || [];
    assert(matches.length > 0, 'No matches returned for thread_week query');

    const m = matches.find((m) => m?.metadata?.thread_id && m?.metadata?.week_key && m?.metadata?.summary_text);
    assert(!!m, 'No match with thread_id, week_key, and summary_text in metadata');

    const tid = String(m.metadata.thread_id);
    const wk = String(m.metadata.week_key);

    // Ensure augmentation resolved the thread-week compound key
    assert(m.metadata.summary_kind === 'thread', 'summary_kind should be "thread" for thread_week');
    assert(m.metadata.summary_key === `${tid}@${wk}`,'summary_key should equal `${threadId}@${weekKey}`');

    // If a persisted file exists, verify that augmentation preferred it and content matches
    const fileText = tryReadThreadWeekFile(GRANT_ID, tid, wk);
    const metaPrefix = String(m.metadata.summary_text || '').slice(0, 120).replace(/\s+/g, ' ').trim();
    if (fileText) {
      const filePrefix = fileText.slice(0, 120).replace(/\s+/g, ' ').trim();
      assert(filePrefix.length > 0, 'Thread-week summary file is empty');
      assert(metaPrefix.includes(filePrefix.slice(0, 30)) || filePrefix.includes(metaPrefix.slice(0, 30)),
        'metadata.summary_text does not reflect thread-week file content');
      assert(m.metadata.summary_source === 'file', 'summary_source should be "file" when persisted summary exists');
    } else {
      // Otherwise we expect augmentation to fall back to metadata
      assert(m.metadata.summary_source === 'metadata', 'summary_source should be "metadata" when file is absent');
      assert(metaPrefix.length >= 20, 'summary_text too short');
    }

    // Ensure ISO week range present when week_key exists
    assert(!!m.metadata.week_start_iso && !!m.metadata.week_end_iso, 'week_start_iso/week_end_iso not present');

    console.log('[unit] thread_week augmentation: PASS');
    process.exit(0);
  } catch (e) {
    console.error('[unit] thread_week augmentation: FAIL');
    console.error(e);
    process.exit(1);
  }
})();

