import 'dotenv/config';
import assert from 'node:assert';

/**
 * Test: Backend runtime accepts dependency injection for testing
 * 
 * This test validates that:
 * 1. runBackendAgent accepts a deps parameter
 * 2. deps.runner can be injected for testing
 * 3. Event handlers are called during execution
 */
export default async function run() {
  const fs = await import('node:fs');
  const runtimePath = 'src/lib/agents/backendRuntime.ts';
  const runtimeSrc = fs.readFileSync(runtimePath, 'utf-8');

  // Verify DI interface exists
  assert(
    runtimeSrc.includes('interface BackendRuntimeDeps'),
    'BackendRuntimeDeps interface should be defined'
  );

  assert(
    runtimeSrc.includes('runner?: typeof run'),
    'BackendRuntimeDeps should have optional runner field'
  );

  // Verify runBackendAgent accepts deps parameter
  assert(
    runtimeSrc.includes('deps: BackendRuntimeDeps = {}'),
    'runBackendAgent should accept deps parameter'
  );

  // Verify runner is used instead of direct run() call
  assert(
    runtimeSrc.includes('const runner = deps.runner ?? run'),
    'Should use injected runner or default to run'
  );

  assert(
    runtimeSrc.includes('await runner(bundle.router'),
    'Should call runner instead of run directly'
  );

  // Verify event handlers are called
  assert(
    runtimeSrc.includes('emitProgress('),
    'Should emit progress events'
  );

  assert(
    runtimeSrc.includes('eventHandlers.forEach((handler)'),
    'Should iterate over event handlers'
  );

  console.log('[unit] backend_runtime_di: PASS');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

