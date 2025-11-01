import fs from 'node:fs';
import assert from 'node:assert';

export default async function run() {
  const p1 = 'src/lib/tools.ts';
  const src1 = fs.readFileSync(p1, 'utf-8');

  function mustInclude(src, pattern, msg, path) {
    assert(src.includes(pattern), `Missing pattern in ${path}: ${msg || pattern}`);
  }

  // ToolCallRecord must include id
  mustInclude(src1, 'interface ToolCallRecord', 'ToolCallRecord interface', p1);
  mustInclude(src1, 'id: string', 'ToolCallRecord.id string', p1);

  // logToolCall must generate id values
  mustInclude(src1, 'function logToolCall(', 'logToolCall exists', p1);
  mustInclude(src1, 'id: `tool-', 'logToolCall generates prefixed id', p1);

  // voiceAgentHybrid should map UI events to ToolCallRecord with id preserved
  const p2 = 'src/lib/voiceAgentHybrid.ts';
  const src2 = fs.readFileSync(p2, 'utf-8');
  mustInclude(src2, 'export function formatDashboardEventAsToolCall', 'formatDashboardEventAsToolCall export', p2);
  mustInclude(src2, 'id:', 'formatDashboardEventAsToolCall returns id field', p2);

  console.log('[unit] tools_contract: PASS');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

