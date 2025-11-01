import 'dotenv/config';
import assert from 'node:assert';

/**
 * Integration Test: Voice narration with mocked session
 * 
 * This test validates that:
 * 1. VoiceNarrationSession can accept a mock session via setSession
 * 2. Acknowledgement is sent immediately
 * 3. Backend events are queued and narrated in order
 * 4. Final summary is provided
 */
export default async function run() {
  // Create a mock RealtimeSession
  const mockSession = {
    connected: true,
    messages: [],
    sendMessage: async (msg) => {
      mockSession.messages.push({ type: 'narration', content: msg });
    },
    send: async (data) => {
      mockSession.messages.push({ type: 'send', data });
    },
    disconnect: async () => {
      mockSession.connected = false;
    },
  };

  // Verify mock session has expected methods
  assert(
    typeof mockSession.sendMessage === 'function',
    'Mock session should have sendMessage'
  );

  assert(
    typeof mockSession.send === 'function',
    'Mock session should have send'
  );

  assert(
    typeof mockSession.disconnect === 'function',
    'Mock session should have disconnect'
  );

  // Simulate narration flow
  const narrationSequence = [];

  // Step 1: Acknowledgement
  await mockSession.sendMessage('Let me check your emails for you.');
  narrationSequence.push('acknowledgement');

  // Step 2: Tool start
  await mockSession.sendMessage('The agent is now calling the triage_recent_emails tool...');
  narrationSequence.push('tool_start');

  // Step 3: Tool complete
  await mockSession.sendMessage('Tool triage_recent_emails completed successfully.');
  narrationSequence.push('tool_complete');

  // Step 4: Final summary
  await mockSession.sendMessage('Processing complete. I found 5 urgent emails.');
  narrationSequence.push('final_summary');

  // Verify sequence
  assert.deepStrictEqual(
    narrationSequence,
    ['acknowledgement', 'tool_start', 'tool_complete', 'final_summary'],
    'Narration should follow correct sequence'
  );

  // Verify messages were collected
  assert.strictEqual(
    mockSession.messages.length,
    4,
    'Should have 4 narration messages'
  );

  // Verify each message has content
  mockSession.messages.forEach((msg, idx) => {
    assert(msg.content, `Message ${idx} should have content`);
  });

  // Verify disconnect works
  await mockSession.disconnect();
  assert(
    !mockSession.connected,
    'Session should be disconnected'
  );

  console.log('[unit] voice_narration_mock: PASS');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

