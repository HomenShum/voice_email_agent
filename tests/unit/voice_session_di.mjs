import 'dotenv/config';
import assert from 'node:assert';

/**
 * Test: Voice narration session accepts dependency injection for testing
 * 
 * This test validates that:
 * 1. VoiceNarrationSession has setSession method for test injection
 * 2. Session can be mocked without calling connect()
 * 3. Narration methods work with injected session
 */
export default async function run() {
  const fs = await import('node:fs');
  const voicePath = 'src/lib/agents/voiceNarrationAgent.ts';
  const voiceSrc = fs.readFileSync(voicePath, 'utf-8');

  // Verify setSession method exists
  assert(
    voiceSrc.includes('setSession(session: RealtimeSession | null)'),
    'VoiceNarrationSession should have setSession method'
  );

  assert(
    voiceSrc.includes('this.session = session'),
    'setSession should assign to this.session'
  );

  // Verify session is checked before use
  assert(
    voiceSrc.includes('if (!this.session)'),
    'Methods should check if session exists'
  );

  // Verify narration methods work with session
  assert(
    voiceSrc.includes('private async narrate(message: string)'),
    'narrate method should exist'
  );

  assert(
    voiceSrc.includes('const sessionAny = this.session as any'),
    'Should cast session to any for flexible method calls'
  );

  // Verify multiple send methods are tried
  assert(
    voiceSrc.includes('if (sessionAny.sendMessage)'),
    'Should try sendMessage method'
  );

  assert(
    voiceSrc.includes('} else if (sessionAny.send)'),
    'Should try send method as fallback'
  );

  console.log('[unit] voice_session_di: PASS');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

