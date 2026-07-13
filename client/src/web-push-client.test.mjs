/**
 * 测试 web-push-client.js：VAPID 解码、环境支持与开通提示文案。
 * Keywords: web-push, tests
 * Exports: 无导出 / 内含用例
 * Inward: web-push-client.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  browserPushSupported,
  notificationEnablementMessage,
  urlBase64ToUint8Array
} from './web-push-client.js';

test('urlBase64ToUint8Array converts a VAPID public key into bytes', () => {
  assert.deepEqual([...urlBase64ToUint8Array('AQIDBA')], [1, 2, 3, 4]);
});

test('browserPushSupported requires service worker, PushManager, and Notification', () => {
  assert.equal(browserPushSupported({
    navigator: { serviceWorker: {} },
    PushManager: function PushManager() {},
    Notification: { requestPermission() {} }
  }), true);
  assert.equal(browserPushSupported({
    navigator: {},
    PushManager: function PushManager() {},
    Notification: { requestPermission() {} }
  }), false);
});

test('notificationEnablementMessage explains iOS PWA secure-context requirements', () => {
  assert.match(notificationEnablementMessage({ supported: false, secureContext: false }), /HTTPS/);
  assert.match(notificationEnablementMessage({ supported: false, secureContext: true, standalone: true }), /Web Push/);
  assert.match(notificationEnablementMessage({ supported: true, secureContext: true, standalone: false }), /主屏幕/);
  assert.match(notificationEnablementMessage({ supported: true, secureContext: true, standalone: true }), /任务完成/);
});
