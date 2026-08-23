/**
 * 测试 websocket-heartbeat.js：半开移动连接会被服务端终止。
 * Keywords: websocket, heartbeat, tests
 * Exports: 无导出 / 内含用例
 * Inward: websocket-heartbeat.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { pulseWebSocketClients } from './websocket-heartbeat.js';

test('pulseWebSocketClients pings healthy clients and terminates stale clients', () => {
  let pinged = 0;
  let terminated = 0;
  const live = {
    readyState: 1,
    isAlive: true,
    ping() {
      pinged += 1;
    }
  };
  const stale = {
    readyState: 1,
    isAlive: false,
    terminate() {
      terminated += 1;
    }
  };

  assert.deepEqual(pulseWebSocketClients([live, stale]), { pinged: 1, terminated: 1 });
  assert.equal(live.isAlive, false);
  assert.equal(pinged, 1);
  assert.equal(terminated, 1);
});
