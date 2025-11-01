import fs from 'node:fs';
import assert from 'node:assert';

export default async function run() {
  const p = 'src/lib/agents/backendRuntime.ts';
  const src = fs.readFileSync(p, 'utf-8');

  function mustInclude(pattern, msg) {
    assert(src.includes(pattern), `Missing pattern in ${p}: ${msg || pattern}`);
  }

  // Exported APIs
  mustInclude('export function createBackendRuntime(', 'createBackendRuntime export');
  mustInclude('export async function runBackendAgent(', 'runBackendAgent export');
  mustInclude('class BackendEventStream', 'BackendEventStream class');
  mustInclude('export function formatEventForVoiceNarration(', 'formatEventForVoiceNarration export');
  mustInclude('export function formatEventForUIDashboard(', 'formatEventForUIDashboard export');

  // Voice narration content checks (immediate ack + progress + completion)
  mustInclude("I'm routing your request to the ", 'Immediate routing acknowledgement');
  mustInclude('The agent is now calling the ', 'Tool start narration');
  mustInclude('Tool ', 'Tool completed narration (prefix)');
  mustInclude('Processing complete. Let me summarize the results...', 'Completion narration');

  console.log('[unit] backend_runtime_contract: PASS');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

