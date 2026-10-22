import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { McpSessionRegistry, mcpSessionTracker } from './index.js';

console.log('========================================================================');
console.log('OPEN SOURCE MINI-CHALLENGE: mcp-session-reaper TEST SUITE');
console.log('========================================================================');

async function runTests() {
  console.log('\n[Test 1] Initializing McpSessionRegistry with custom idle timeout...');
  const registry = new McpSessionRegistry({
    idleTimeoutMs: 50, // 50ms for testing
    reapIntervalMs: 20
  });

  assert.strictEqual(registry.size, 0, 'Initial registry size must be 0');
  console.log('[PASS] Registry initialized.');

  console.log('\n[Test 2] Registering and retrieving active MCP transport session...');
  let transportClosed = false;
  const mockTransport = {
    sessionId: 'session-abc-123',
    close: async () => { transportClosed = true; }
  };
  const mockServer = { name: 'test-mcp-server' };

  registry.register('session-abc-123', mockTransport, mockServer);
  assert.strictEqual(registry.size, 1, 'Registry must contain 1 session');

  const retrieved = registry.get('session-abc-123');
  assert(retrieved, 'Session must be retrieved');
  assert.strictEqual(retrieved.openSockets, 0, 'Open sockets must start at 0');
  console.log('[PASS] Registration and retrieval verified.');

  console.log('\n[Test 3] Tracking socket lifetime via response close listeners...');
  const mockRes = new EventEmitter();
  mockRes.socket = {};
  mockRes.destroyed = false;

  registry.trackResponse('session-abc-123', mockRes);
  assert.strictEqual(registry.get('session-abc-123').openSockets, 1, 'Open sockets must increment to 1');

  mockRes.emit('close');
  assert.strictEqual(registry.get('session-abc-123').openSockets, 0, 'Open sockets must decrement to 0 upon close');
  console.log('[PASS] Socket lifetime tracking verified.');

  console.log('\n[Test 4] Verifying Express middleware hook mcpSessionTracker...');
  const middleware = mcpSessionTracker(registry);
  let nextCalled = false;
  const req = { headers: { 'mcp-session-id': 'session-abc-123' } };
  const res = new EventEmitter();
  res.socket = {};

  middleware(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true, 'Middleware must call next()');
  assert.strictEqual(registry.get('session-abc-123').openSockets, 1, 'Middleware must attach response tracking');
  res.emit('close');
  assert.strictEqual(registry.get('session-abc-123').openSockets, 0);
  console.log('[PASS] Express middleware verified.');

  console.log('\n[Test 5] Verifying automated reaper eviction of stale idle sessions...');
  // Artificially age the session
  registry.get('session-abc-123').lastActiveAt = Date.now() - 100;

  await registry.reapStaleSessions();
  assert.strictEqual(registry.size, 0, 'Stale session must be reaped');
  assert.strictEqual(transportClosed, true, 'Transport close hook must be called');
  console.log('[PASS] Reaper eviction verified 100%.');

  registry.destroy();
  console.log('\n========================================================================');
  console.log('ALL mcp-session-reaper TESTS PASSED WITH 100% SUCCESS');
  console.log('========================================================================\n');
}

runTests().catch(err => {
  console.error('[TEST ERROR]:', err);
  process.exit(1);
});
