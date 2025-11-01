import assert from 'node:assert';

const tests = [
  './backend_runtime_contract.mjs',
  './hybrid_bridge_contract.mjs',
  './voice_narration_disconnect_contract.mjs',
  './tools_contract.mjs',
  './backend_event_stream.mjs',
  './voice_narration_queue.mjs',
  './backend_runtime_di.mjs',
  './voice_session_di.mjs',
  './backend_runtime_mock.mjs',
  './voice_narration_mock.mjs',
  './hybrid_bridge_mock.mjs',
];

(async () => {
  let passed = 0;
  for (const t of tests) {
    const mod = await import(new URL(t, import.meta.url));
    assert(typeof mod.default === 'function', `${t} does not export default async function`);
    await mod.default();
    passed++;
  }
  console.log(`\n[unit] All contract tests passed (${passed}/${tests.length})`);
})().catch((e) => { console.error(e); process.exit(1); });

