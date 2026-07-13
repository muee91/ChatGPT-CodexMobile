/**
 * 测试 server/runtime-debug.js：节流、activeRuns 压缩与事件行格式。
 *
 * Keywords: runtime-debug, test, jsonl
 *
 * Exports: 无导出，内含用例
 *
 * Inward: runtime-debug.js
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactActiveRuns,
  isRuntimeDebugEnabled,
  runtimeDebugLine,
  runtimeDebugStatusActiveRuns
} from './runtime-debug.js';

test('compactActiveRuns maps stable shape', () => {
  const rows = [
    { sessionId: 's1', turnId: 't1', previousSessionId: 'p', source: 'x', status: 'running', steerable: true }
  ];
  assert.deepEqual(compactActiveRuns(rows), [
    {
      sessionId: 's1',
      turnId: 't1',
      previousSessionId: 'p',
      source: 'x',
      status: 'running',
      steerable: true
    }
  ]);
});

test('runtime debug helpers do not throw when disabled', () => {
  if (!isRuntimeDebugEnabled()) {
    assert.doesNotThrow(() => {
      runtimeDebugLine('test.event', { ok: true });
      runtimeDebugStatusActiveRuns([]);
    });
  }
});
