/**
 * Test script to verify backend tool events are being emitted correctly
 * 
 * Usage:
 *   node test-backend-events.mjs
 */

const FUNCTIONS_BASE = process.env.FUNCTIONS_BASE || 'https://func-email-agent-9956-lx.azurewebsites.net';
const GRANT_ID = process.env.GRANT_ID || '22dd5c25-157e-4377-af23-e06602fdfcec';

async function testBackendEvents() {
  console.log('🧪 Testing backend tool events...');
  console.log(`📍 Functions Base: ${FUNCTIONS_BASE}`);
  console.log(`🔑 Grant ID: ${GRANT_ID}`);
  console.log('');

  const userInput = 'Can you search for emails about security alerts?';
  console.log(`📨 Sending request: "${userInput}"`);
  console.log('');

  try {
    const response = await fetch(`${FUNCTIONS_BASE}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userInput, grantId: GRANT_ID }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Backend request failed: ${response.status} ${errorText}`);
    }

    console.log('✅ Connected to backend SSE stream');
    console.log('📡 Listening for events...');
    console.log('');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventCount = 0;
    let toolStartedCount = 0;
    let toolCompletedCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        try {
          const event = JSON.parse(line.slice(6));
          eventCount++;

          console.log(`[Event #${eventCount}] Type: ${event.type}`);

          if (event.type === 'tool_started') {
            toolStartedCount++;
            console.log(`  ✨ Tool Started: ${event.toolName}`);
            console.log(`  📥 Parameters:`, JSON.stringify(event.parameters, null, 2));
            console.log(`  🤖 Agent: ${event.agentId || 'unknown'}`);
          } else if (event.type === 'tool_completed') {
            toolCompletedCount++;
            console.log(`  ✅ Tool Completed: ${event.toolName}`);
            console.log(`  📤 Result:`, JSON.stringify(event.result, null, 2));
            console.log(`  ⏱️  Duration: ${event.durationMs || 'unknown'}ms`);
          } else if (event.type === 'agent_started') {
            console.log(`  🚀 Agent Started: ${event.agentName || event.agentId}`);
          } else if (event.type === 'agent_completed') {
            console.log(`  🏁 Agent Completed`);
            console.log(`  📝 Output:`, typeof event.output === 'string' ? event.output.slice(0, 100) + '...' : JSON.stringify(event.output));
          } else if (event.type === 'final') {
            console.log(`  🎯 Final Result:`, typeof event.result === 'string' ? event.result.slice(0, 100) + '...' : JSON.stringify(event.result));
          } else if (event.type === 'error') {
            console.log(`  ❌ Error:`, event.error);
          } else {
            console.log(`  ℹ️  Other event:`, event.type);
          }

          console.log('');
        } catch (parseError) {
          console.warn('⚠️  Failed to parse SSE event:', line);
        }
      }
    }

    console.log('');
    console.log('📊 Summary:');
    console.log(`  Total events: ${eventCount}`);
    console.log(`  Tool started events: ${toolStartedCount}`);
    console.log(`  Tool completed events: ${toolCompletedCount}`);
    console.log('');

    if (toolStartedCount === 0 && toolCompletedCount === 0) {
      console.log('❌ NO TOOL EVENTS DETECTED!');
      console.log('   This means the backend is NOT emitting tool_started/tool_completed events.');
      console.log('   The UI will remain empty because no tool events are being sent.');
    } else {
      console.log('✅ Tool events are being emitted correctly!');
      console.log('   If the UI is still empty, the issue is on the client side.');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testBackendEvents();

