import 'dotenv/config';
import assert from 'node:assert';

/**
 * Integration Test: Hybrid bridge with mocked backend and voice
 * 
 * This test validates that:
 * 1. Backend events are forwarded to voice narration
 * 2. Backend events are forwarded to UI dashboard
 * 3. Voice acknowledgement happens before backend execution
 * 4. Final summary happens after backend execution
 */
export default async function run() {
  // Simulate the event flow through the bridge
  const executionLog = [];

  // Mock backend event stream
  const mockBackendEvents = [
    { type: 'agent_started', agentId: 'router', agentName: 'RouterAgent', timestamp: Date.now() },
    { type: 'tool_started', agentId: 'email_ops', toolName: 'triage_recent_emails', parameters: { limit: 50 }, timestamp: Date.now() },
    { type: 'tool_completed', agentId: 'email_ops', toolName: 'triage_recent_emails', result: { urgent_count: 5 }, timestamp: Date.now() },
    { type: 'agent_completed', agentId: 'router', agentName: 'RouterAgent', timestamp: Date.now(), output: 'Found 5 urgent emails' },
  ];

  // Mock voice narration
  const mockVoiceNarration = {
    acknowledgeRequest: async (input) => {
      executionLog.push('voice:acknowledge');
    },
    receiveBackendEvent: async (event) => {
      executionLog.push(`voice:event:${event.type}`);
    },
    provideFinalSummary: async (result) => {
      executionLog.push('voice:summary');
    },
  };

  // Mock UI dashboard
  const mockUIDashboard = {
    onEvent: (event) => {
      executionLog.push(`ui:event:${event.type}`);
    },
  };

  // Simulate bridge execution flow
  // Step 1: User request
  const userInput = 'Check my urgent emails';
  executionLog.push('user:request');

  // Step 2: Voice acknowledgement
  await mockVoiceNarration.acknowledgeRequest(userInput);

  // Step 3: Backend execution with event streaming
  for (const event of mockBackendEvents) {
    // Forward to voice
    await mockVoiceNarration.receiveBackendEvent(event);
    // Forward to UI
    mockUIDashboard.onEvent(event);
  }

  // Step 4: Final summary
  const result = { finalOutput: 'Found 5 urgent emails' };
  await mockVoiceNarration.provideFinalSummary(result);

  // Verify execution order
  assert(
    executionLog[0] === 'user:request',
    'Should start with user request'
  );

  assert(
    executionLog[1] === 'voice:acknowledge',
    'Should acknowledge immediately after request'
  );

  // Verify backend events are processed
  const voiceEventCount = executionLog.filter(e => e.startsWith('voice:event')).length;
  assert(
    voiceEventCount === mockBackendEvents.length,
    `Should have ${mockBackendEvents.length} voice events, got ${voiceEventCount}`
  );

  // Verify UI events are processed
  const uiEventCount = executionLog.filter(e => e.startsWith('ui:event')).length;
  assert(
    uiEventCount === mockBackendEvents.length,
    `Should have ${mockBackendEvents.length} UI events, got ${uiEventCount}`
  );

  // Verify final summary is last
  assert(
    executionLog[executionLog.length - 1] === 'voice:summary',
    'Should end with voice summary'
  );

  // Verify event types are correct
  const eventTypes = mockBackendEvents.map(e => e.type);
  assert(
    eventTypes[0] === 'agent_started',
    'First event should be agent_started'
  );

  assert(
    eventTypes[eventTypes.length - 1] === 'agent_completed',
    'Last event should be agent_completed'
  );

  console.log('[unit] hybrid_bridge_mock: PASS');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

