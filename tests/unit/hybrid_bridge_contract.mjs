import fs from 'node:fs';
import assert from 'node:assert';

export default async function run() {
  const p = 'src/lib/agents/hybridAgentBridge.ts';
  const src = fs.readFileSync(p, 'utf-8');

  function mustInclude(pattern, msg) {
    assert(src.includes(pattern), `Missing pattern in ${p}: ${msg || pattern}`);
  }

  // Voice acknowledgment and summary hooks
  mustInclude('await this.voiceSession.acknowledgeRequest(', 'Voice acknowledgeRequest call');
  mustInclude('await this.voiceSession.provideFinalSummary(', 'Voice provideFinalSummary call');

  // Backend execution handoff
  mustInclude('await runBackendAgent(this.backendBundle', 'Calls runBackendAgent with backend bundle');

  // Event stream wiring
  mustInclude('this.eventStream.emit(event)', 'Backend events emitted to stream');
  mustInclude('formatEventForUIDashboard(event)', 'UI dashboard formatting present');

  console.log('[unit] hybrid_bridge_contract: PASS');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

