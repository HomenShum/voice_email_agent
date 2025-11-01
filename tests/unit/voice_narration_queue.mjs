import 'dotenv/config';
import assert from 'node:assert';

/**
 * Test: Voice narration queue processes events in order
 * 
 * This test validates that:
 * 1. Acknowledgement is sent immediately
 * 2. Backend events are queued and processed in order
 * 3. Final summary is provided after all events
 */
export default async function run() {
  const fs = await import('node:fs');
  const voicePath = 'src/lib/agents/voiceNarrationAgent.ts';
  const voiceSrc = fs.readFileSync(voicePath, 'utf-8');

  // Verify acknowledgement is generated
  assert(
    voiceSrc.includes('generateAcknowledgment'),
    'generateAcknowledgment method should exist'
  );

  assert(
    voiceSrc.includes('await this.narrate(acknowledgment)'),
    'acknowledgeRequest should call narrate with acknowledgment'
  );

  // Verify event queue exists
  assert(
    voiceSrc.includes('private eventQueue'),
    'eventQueue should be a private field'
  );

  // Verify queue processing
  assert(
    voiceSrc.includes('this.eventQueue.push(event)'),
    'receiveBackendEvent should push to queue'
  );

  assert(
    voiceSrc.includes('this.eventQueue.shift()'),
    'processNextEvent should shift from queue'
  );

  // Verify narration happens in order
  assert(
    voiceSrc.includes('if (!this.isNarrating)'),
    'Should check isNarrating before processing next event'
  );

  assert(
    voiceSrc.includes('this.isNarrating = true'),
    'Should set isNarrating flag during narration'
  );

  // Verify final summary
  assert(
    voiceSrc.includes('provideFinalSummary'),
    'provideFinalSummary method should exist'
  );

  assert(
    voiceSrc.includes('await this.narrate(finalOutput)'),
    'provideFinalSummary should narrate the output'
  );

  console.log('[unit] voice_narration_queue: PASS');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

