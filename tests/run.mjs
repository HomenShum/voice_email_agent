import 'dotenv/config';

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { CASES } from "./cases.mjs";
import { judgeCase } from "./judge.mjs";

const FUNCTIONS_BASE = process.env.FUNCTIONS_BASE || "http://localhost:7071"; // Azure Functions host
const RESULTS_DIR = path.resolve(process.cwd(), "tests/results");
const NOW = new Date().toISOString().replace(/[:.]/g, "-");
const SUMMARY_PATH = path.join(RESULTS_DIR, `summary-${NOW}.json`);
const BOOLEAN_FIELDS = ["has_attachments", "unread", "starred"];
const booleanMetrics = Object.fromEntries(
  BOOLEAN_FIELDS.map((field) => [
    field,
    { true: 0, false: 0, invalid: [] },
  ]),
);
const LLM_ENABLED = process.env.JUDGE_DISABLE_LLM !== '1' && !!process.env.OPENAI_API_KEY;


async function postJSON(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function writeSnapshot(id, obj) {
  ensureDir(RESULTS_DIR);
  const file = path.join(RESULTS_DIR, `${id}-${NOW}.json`);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf-8");
  return file;
}

function compareWithLastSnapshot(id, current) {
  if (!fs.existsSync(RESULTS_DIR)) return { changed: false, diff: null };
  const prefix = `${id}-`;
  const files = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort();
  const last = files.slice(-2)[0];
  if (!last) return { changed: false, diff: null };
  const prev = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, last), "utf-8"));
  const currStr = JSON.stringify(current);
  const prevStr = JSON.stringify(prev);
  return { changed: currStr !== prevStr, diff: null };
}

function recordBooleanMetric(field, value, context) {
  if (!(field in booleanMetrics)) return;
  if (value === undefined || value === null) return;
  if (typeof value === "boolean") {
    booleanMetrics[field][value ? "true" : "false"] += 1;
    return;
  }
  booleanMetrics[field].invalid.push({ ...context, value });
}

async function run() {
  ensureDir(RESULTS_DIR);
  const results = [];

  for (const c of CASES) {
    const { id, scenario, user_query, namespace, search, expect } = c;

    // 1) search
    const searchRes = await postJSON(`${FUNCTIONS_BASE}/api/search`, {
      grantId: namespace,
      query: search.query,
      topK: search.topK ?? 5,
      types: search.types,
      threadId: search.threadId,
      bucket: search.bucket,
      dateFrom: search.dateFrom,
      dateTo: search.dateTo,
    });
    const matches = searchRes.matches ?? searchRes.results ?? [];
    for (const match of matches) {
      const metadata = match?.metadata || {};
      if (!metadata || typeof metadata !== "object") continue;
      for (const field of BOOLEAN_FIELDS) {
        recordBooleanMetric(field, metadata[field], { caseId: id, matchId: match?.id });
      }
    }

    // 2) aggregate (from_domain by default) on the same query
    let aggregation = {};
    try {
      aggregation = await postJSON(`${FUNCTIONS_BASE}/api/aggregate`, {
        grantId: namespace,
        query: search.query,
        topK: search.topK ?? 50,
        types: search.types,
        threadId: search.threadId,
        bucket: search.bucket,
        dateFrom: search.dateFrom,
        dateTo: search.dateTo,
        groupBy: "from_domain",
      });
    } catch (e) {
      aggregation = { error: String(e) };
    }

    // 3) snapshot
    const snapshot = {
      case: c,
      search_matches: matches,
      aggregation,
    };
    const snapPath = writeSnapshot(id, snapshot);
    if (typeof c.assert === "function") {
      await c.assert({
        matches: snapshot.search_matches,
        search: searchRes,
        aggregation,
        case: c,
      });
    }

    // 4) judge (content-agnostic mode by default; only judge when LLM is enabled)
    let judge;
    if (LLM_ENABLED) {
      judge = await judgeCase({
        scenario,
        user_query,
        expectation: expect,
        system_outputs: {
          matches: snapshot.search_matches,
          aggregation,
        },
      });
    } else {
      judge = {
        usefulness: true,
        correctness: true,
        pass: true,
        rationale: "LLM judge skipped (functional checks only)",
      };
    }

    // 5) minimal regression check
    const reg = compareWithLastSnapshot(id, snapshot);

    results.push({
      id,
      judge,
      snapshot: snapPath,
      regression_changed: reg.changed,
    });

    console.log(`[${id}] pass=${judge.pass}  useful=${judge.usefulness}  correct=${judge.correctness}  regress_changed=${reg.changed}`);
  }

  const summary = {
    at: NOW,
    totals: {
      cases: results.length,
      pass: results.filter((r) => r.judge.pass).length,
      fail: results.filter((r) => !r.judge.pass).length,
    },
    details: results,
    boolean_metrics: Object.fromEntries(
      Object.entries(booleanMetrics).map(([field, stats]) => [
        field,
        {
          true: stats.true,
          false: stats.false,
          invalid: stats.invalid.length,
        },
      ]),
    ),
  };
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2), "utf-8");

  console.log(`\nSaved summary -> ${SUMMARY_PATH}\n`);

  const invalidFields = Object.entries(booleanMetrics).filter(([, stats]) => stats.invalid.length);
  if (invalidFields.length) {
    const report = invalidFields
      .map(([field, stats]) => {
        const samples = stats.invalid
          .slice(0, 5)
          .map((entry) => `${entry.caseId}${entry.matchId ? `#${entry.matchId}` : ""}=${JSON.stringify(entry.value)}`)
          .join(", ");
        return `${field}: invalid=${stats.invalid.length}${samples ? ` (samples: ${samples})` : ""}`;
      })
      .join("\n");
    throw new Error(`Boolean metric tracking detected non-boolean values:\n${report}`);
  }

  assert.strictEqual(summary.totals.fail, 0, "One or more test cases failed (see summary).");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
