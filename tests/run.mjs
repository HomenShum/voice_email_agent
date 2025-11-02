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
const E2E_AGENT_VERIFY = process.env.E2E_AGENT_VERIFY !== '0';
const E2E_PINECONE_VERIFY = process.env.E2E_PINECONE_VERIFY === '1';


async function postJSON(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  // If SSE, caller should not use this helper
  return r.json();
}

async function getJSON(url) {
  const r = await fetch(url, { method: "GET" });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function collectAgentRun({ grantId, userInput, timeoutMs = 20000 }) {
  const r = await fetch(`${FUNCTIONS_BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userInput, grantId })
  });
  if (!r.ok) throw new Error(`/api/agent -> ${r.status}`);
  if (!r.body || typeof r.body.getReader !== 'function') {
    throw new Error('Agent response is not a ReadableStream');
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const all = [];
  const tool = [];
  const agent = [];
  let final = null;
  const start = Date.now();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if (!frame.startsWith('data:')) continue;
      const dataStr = frame.slice(5).trim();
      if (!dataStr) continue;
      try {
        const evt = JSON.parse(dataStr);
        all.push(evt);
        const t = evt?.type;
        if (t === 'final') final = evt.result || evt;
        if (t && (t === 'agent_started' || t === 'agent_completed')) agent.push(evt);
        if (t && String(t).startsWith('tool_')) tool.push(evt);
      } catch {}
    }
    if (final) break;
    if (Date.now() - start > timeoutMs) break;
  }
  return { allEvents: all, toolEvents: tool, agentEvents: agent, final };
}

/**
 * Verify tool invocation expectations
 * @param {Array} toolEvents - Tool events from agent run
 * @param {Object} expectations - { requiredAnyOfTools?: string[], requiredAllTools?: string[] }
 * @returns {Object} - { passed: boolean, called: Set<string>, missing: string[] }
 */
function verifyToolInvocations(toolEvents, expectations) {
  if (!expectations) return { passed: true, called: new Set(), missing: [] };

  const started = (toolEvents || []).filter(e => e.type === 'tool_started' || e.type === 'tool_call_started');
  const called = new Set(started.map(e => e.toolName).filter(Boolean));

  const missing = [];

  // Check requiredAnyOfTools
  if (expectations.requiredAnyOfTools?.length) {
    const ok = expectations.requiredAnyOfTools.some(t => called.has(t));
    if (!ok) {
      missing.push(`Expected one of: ${expectations.requiredAnyOfTools.join(', ')}; got: ${Array.from(called).join(', ') || 'none'}`);
    }
  }

  // Check requiredAllTools
  if (expectations.requiredAllTools?.length) {
    for (const tool of expectations.requiredAllTools) {
      if (!called.has(tool)) {
        missing.push(`Expected tool '${tool}' to be called; got: ${Array.from(called).join(', ') || 'none'}`);
      }
    }
  }

  return {
    passed: missing.length === 0,
    called,
    missing,
    toolEvents: started,
  };
}

/**
 * Extract tool call details for verification
 * @param {Array} toolEvents - Tool events from agent run
 * @returns {Object} - Map of toolName -> { started, completed, parameters, result, durationMs }
 */
function extractToolDetails(toolEvents) {
  const details = {};

  for (const evt of toolEvents || []) {
    const toolName = evt.toolName;
    if (!toolName) continue;

    if (!details[toolName]) {
      details[toolName] = { calls: [] };
    }

    if (evt.type === 'tool_started' || evt.type === 'tool_call_started') {
      details[toolName].calls.push({
        started: evt.timestamp,
        parameters: evt.parameters,
      });
    } else if (evt.type === 'tool_completed' || evt.type === 'tool_call_completed') {
      const lastCall = details[toolName].calls[details[toolName].calls.length - 1];
      if (lastCall) {
        lastCall.completed = evt.timestamp;
        lastCall.durationMs = evt.durationMs;
        lastCall.result = evt.result;
      }
    }
  }

  return details;
}

/**
 * Verify tool result data shapes and content
 * @param {Object} toolDetails - Tool details from extractToolDetails
 * @param {Object} expectations - { toolName: { resultShape: {...}, minCount?: number } }
 * @returns {Object} - { passed: boolean, errors: string[] }
 */
function verifyToolResults(toolDetails, expectations) {
  const errors = [];

  if (!expectations) return { passed: true, errors: [] };

  for (const [toolName, expectation] of Object.entries(expectations)) {
    const toolDetail = toolDetails[toolName];
    if (!toolDetail) {
      errors.push(`Tool '${toolName}' was not called`);
      continue;
    }

    const calls = toolDetail.calls || [];
    if (expectation.minCount && calls.length < expectation.minCount) {
      errors.push(`Tool '${toolName}' called ${calls.length} times; expected at least ${expectation.minCount}`);
    }

    // Verify result shape for first call
    if (calls.length > 0 && expectation.resultShape) {
      const result = calls[0].result;
      if (!result) {
        errors.push(`Tool '${toolName}' first call has no result`);
        continue;
      }

      for (const [key, type] of Object.entries(expectation.resultShape)) {
        if (!(key in result)) {
          errors.push(`Tool '${toolName}' result missing key '${key}'`);
        } else if (type && typeof result[key] !== type) {
          errors.push(`Tool '${toolName}' result['${key}'] is ${typeof result[key]}; expected ${type}`);
        }
      }
    }
  }

  return { passed: errors.length === 0, errors };
}

async function getIndexStats(opts = { includePersisted: false }) {
  const qs = opts?.includePersisted ? '?includePersisted=1' : '';
  return getJSON(`${FUNCTIONS_BASE}/api/index/stats${qs}`);
}

async function waitForIndexIncrease({ namespace, before, timeoutMs = 30000, pollMs = 2000 }) {
  const start = Date.now();
  const beforeNs = before?.session?.dense?.byNamespace?.[namespace]?.records || 0;
  while (Date.now() - start < timeoutMs) {
    const now = await getIndexStats();
    const nowNs = now?.session?.dense?.byNamespace?.[namespace]?.records || 0;
    if (nowNs > beforeNs) {
      return { increased: true, before: beforeNs, after: nowNs };
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  const final = await getIndexStats();
  return {
    increased: false,
    before: before?.session?.dense?.byNamespace?.[namespace]?.records || 0,
    after: final?.session?.dense?.byNamespace?.[namespace]?.records || 0,
  };
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

    // 3) build snapshot and optionally collect agent SSE events
    const snapshot = {
      case: c,
      search_matches: matches,
      aggregation,
    };

    let agentRun = null;
    let toolVerification = null;
    if (E2E_AGENT_VERIFY) {
      try {
        agentRun = await collectAgentRun({ grantId: namespace, userInput: user_query });

        // Extract and verify tool invocations
        toolVerification = verifyToolInvocations(agentRun.toolEvents, c.agent_expect);
        const toolDetails = extractToolDetails(agentRun.toolEvents);

        snapshot.agent = {
          tool_events: agentRun.toolEvents,
          tool_details: toolDetails,
          tool_verification: {
            passed: toolVerification.passed,
            called: Array.from(toolVerification.called),
            missing: toolVerification.missing,
          },
          all_events_sample: agentRun.allEvents.slice(0, 50),
          final: agentRun.final,
        };

        // Log tool invocation summary
        if (toolVerification.called.size > 0) {
          console.log(`[${id}] tools called: ${Array.from(toolVerification.called).join(', ')}`);
        } else {
          console.warn(`[${id}] agent run had no tool invocations`);
        }
      } catch (err) {
        snapshot.agent_error = String(err?.message || err);
        console.warn(`[${id}] agent SSE collection failed:`, snapshot.agent_error);
      }
    }

    // Enforce agent tool expectations per-case
    if (toolVerification && !toolVerification.passed) {
      throw new Error(`Tool verification failed for [${id}]: ${toolVerification.missing.join('; ')}`);
    }

    // Optional: Pinecone write verification via delta sync
    if (E2E_PINECONE_VERIFY && process.env.SERVICEBUS_CONNECTION && c.pineconeVerify === 'delta') {
      try {
        const beforeStats = await getIndexStats();
        const beforeCount = beforeStats?.session?.dense?.byNamespace?.[namespace]?.records || 0;
        snapshot.index_before = beforeCount;
        snapshot.index_stats_before = beforeStats;

        try {
          await postJSON(`${FUNCTIONS_BASE}/api/sync/delta`, { grantId: namespace });
          snapshot.delta_enqueued = true;
          console.log(`[${id}] Delta sync enqueued for namespace ${namespace}`);
        } catch (err) {
          snapshot.delta_error = String(err?.message || err);
          console.warn(`[${id}] Delta sync failed:`, snapshot.delta_error);
        }

        const waited = await waitForIndexIncrease({ namespace, before: beforeStats, timeoutMs: 60000 });
        snapshot.index_after = waited.after;
        snapshot.index_increase = {
          before: waited.before,
          after: waited.after,
          delta: waited.after - waited.before,
          increased: waited.increased,
        };

        if (!waited.increased) {
          console.warn(`[${id}] Pinecone index did not increase for ns=${namespace}: ${waited.before} -> ${waited.after}`);
        } else {
          console.log(`[${id}] Pinecone index increased: ${waited.before} -> ${waited.after} (+${waited.after - waited.before})`);
        }
      } catch (err) {
        snapshot.pinecone_verify_error = String(err?.message || err);
        console.warn(`[${id}] Pinecone verification error:`, snapshot.pinecone_verify_error);
      }
    }

    const snapPath = writeSnapshot(id, snapshot);
    if (typeof c.assert === "function") {
      await c.assert({
        matches: snapshot.search_matches,
        search: searchRes,
        aggregation,
        case: c,
        agent: agentRun,
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
