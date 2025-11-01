import fs from 'node:fs';
import assert from 'node:assert';

export default async function run() {
  const p = 'src/lib/agents/voiceNarrationAgent.ts';
  const src = fs.readFileSync(p, 'utf-8');

  function mustInclude(pattern, msg) {
    assert(src.includes(pattern), `Missing pattern in ${p}: ${msg || pattern}`);
  }

  // Defensive disconnect handling patterns
  mustInclude("typeof s.disconnect === 'function'", 'disconnect() fallback present');
  mustInclude("typeof s.close === 'function'", 'close() fallback present');
  mustInclude("s.transport && typeof s.transport.disconnect === 'function'", 'transport.disconnect() fallback present');
  mustInclude("s.transport && typeof s.transport.close === 'function'", 'transport.close() fallback present');

  console.log('[unit] voice_narration_disconnect_contract: PASS');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

