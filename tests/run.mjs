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
      search_matches: searchRes.matches ?? searchRes.results ?? [],
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

    // 4) judge
    const judge = await judgeCase({
      scenario,
      user_query,
      expectation: expect,
      system_outputs: {
        matches: snapshot.search_matches,
        aggregation,
      },
    });

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
  };
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2), "utf-8");

  console.log(`\nSaved summary -> ${SUMMARY_PATH}\n`);
  assert.strictEqual(summary.totals.fail, 0, "One or more test cases failed (see summary).");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
