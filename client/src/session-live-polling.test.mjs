/**
 * 测试 app/useSessionLivePolling.js：选中会话空闲补账轮询的触发条件。
 * Keywords: session-polling, stale-activity, tests
 * Exports: 无导出 / 内含用例
 * Inward: app/useSessionLivePolling.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldPollSelectedSession } from './app/useSessionLivePolling.js';

test('idle selected session still allows polling', () => {
  assert.equal(
    shouldPollSelectedSession({
      authenticated: true,
      selectedSession: { id: 'thread-1' },
      running: false,
      hasRunningActivity: true,
      pollInFlight: false
    }),
    true
  );
});

test('live runtime blocks polling so websocket deltas remain smooth', () => {
  assert.equal(
    shouldPollSelectedSession({
      authenticated: true,
      selectedSession: { id: 'thread-1' },
      running: true,
      hasRunningActivity: true,
      pollInFlight: false
    }),
    false
  );
});
