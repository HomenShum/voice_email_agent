# Unit Tests for Hybrid Agent Architecture

## Overview

This directory contains 11 unit tests that validate the hybrid agent architecture without requiring external API calls or network access.

**Test Status**: ✅ All 11 tests passing

## Test Categories

### 1. Contract Tests (4 tests)
Static source code validation to ensure APIs and wiring are present.

- **backend_runtime_contract.mjs** - Validates backendRuntime.ts exports and narration messages
- **hybrid_bridge_contract.mjs** - Validates bridge wiring (acknowledge → run → summary)
- **voice_narration_disconnect_contract.mjs** - Validates disconnect fallback methods
- **tools_contract.mjs** - Validates ToolCallRecord id field and mapping

### 2. Behavioral Tests (4 tests)
Validate runtime behavior patterns without external calls.

- **backend_event_stream.mjs** - Validates event stream pub/sub pattern
- **voice_narration_queue.mjs** - Validates voice narration queue and ordering
- **backend_runtime_di.mjs** - Validates dependency injection for testing
- **voice_session_di.mjs** - Validates session injection for testing

### 3. Integration Tests (3 tests)
Exercise the runtime with mocked dependencies.

- **backend_runtime_mock.mjs** - Tests backend runner with mock streaming
- **voice_narration_mock.mjs** - Tests voice narration with mock session
- **hybrid_bridge_mock.mjs** - Tests full bridge flow with mocked components

## Running Tests

```bash
# Run all unit tests
npm run test:unit

# Run specific test
node tests/unit/backend_runtime_contract.mjs

# Run all tests (unit + e2e)
npm test
```

## Test Results

```
[unit] backend_runtime_contract: PASS
[unit] hybrid_bridge_contract: PASS
[unit] voice_narration_disconnect_contract: PASS
[unit] tools_contract: PASS
[unit] backend_event_stream: PASS
[unit] voice_narration_queue: PASS
[unit] backend_runtime_di: PASS
[unit] voice_session_di: PASS
[unit] backend_runtime_mock: PASS
[unit] voice_narration_mock: PASS
[unit] hybrid_bridge_mock: PASS

All contract tests passed (11/11)
```

## Key Testing Patterns

### Dependency Injection

The architecture supports DI for testing:

```typescript
// Backend runtime accepts mock runner
await runBackendAgent(bundle, input, options, {
  runner: mockRunner
});

// Voice session accepts mock session
voiceSession.setSession(mockSession);
```

### Mock Implementations

Tests provide realistic mocks:

```javascript
// Mock runner simulates OpenAI Agents SDK
const mockRunner = async (agent, input, options) => ({
  [Symbol.asyncIterator]: async function* () { /* ... */ },
  completed: Promise.resolve(),
  result: { finalOutput: '...' },
  toTextStream: () => ({ /* ... */ }),
});

// Mock session simulates RealtimeSession
const mockSession = {
  sendMessage: async (msg) => { /* ... */ },
  send: async (data) => { /* ... */ },
  disconnect: async () => { /* ... */ },
};
```

### Event Flow Validation

Tests verify correct event ordering:

```javascript
const executionLog = [];
// ... execute flow ...
assert.deepStrictEqual(
  executionLog,
  ['user:request', 'voice:acknowledge', 'voice:event:...', 'voice:summary']
);
```

## Architecture Validation

These tests validate:

1. ✅ Backend runtime exports correct APIs
2. ✅ Event stream distributes to multiple subscribers
3. ✅ Voice narration queues events in order
4. ✅ Acknowledgement happens before backend execution
5. ✅ Final summary happens after backend execution
6. ✅ UI dashboard receives all events
7. ✅ Disconnect handles multiple fallback methods
8. ✅ Tool call records preserve IDs
9. ✅ DI seams allow testing without external calls

## Next Steps

To add more comprehensive tests:

1. **Add ts-node or Node build** to import TypeScript directly
2. **Create behavioral tests** that instantiate actual Agent classes with mocks
3. **Add snapshot tests** for event formatting output
4. **Wire into CI** to run on every PR

## Files Modified

- `package.json` - Added test:unit script
- `src/lib/agents/backendRuntime.ts` - Added BackendRuntimeDeps DI interface
- `src/lib/agents/voiceNarrationAgent.ts` - Added setSession() for DI

## Files Added

- `tests/unit/run-all.mjs` - Test runner
- `tests/unit/backend_runtime_contract.mjs`
- `tests/unit/hybrid_bridge_contract.mjs`
- `tests/unit/voice_narration_disconnect_contract.mjs`
- `tests/unit/tools_contract.mjs`
- `tests/unit/backend_event_stream.mjs`
- `tests/unit/voice_narration_queue.mjs`
- `tests/unit/backend_runtime_di.mjs`
- `tests/unit/voice_session_di.mjs`
- `tests/unit/backend_runtime_mock.mjs`
- `tests/unit/voice_narration_mock.mjs`
- `tests/unit/hybrid_bridge_mock.mjs`

