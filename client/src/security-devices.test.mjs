/**
 * 测试 security-devices.js：设备列表排序、状态标签与摘要文本。
 *
 * Keywords: security-devices, trusted-devices, tests
 *
 * Exports: 无导出 / 内含用例
 *
 * Inward: security-devices.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { deviceMetaText, deviceStatusText, sortDevicesForDisplay } from './security-devices.js';

test('sortDevicesForDisplay keeps current device first and sorts the rest by recent access', () => {
  const sorted = sortDevicesForDisplay([
    { id: 'old', lastSeenAt: '2026-05-10T00:00:00.000Z' },
    { id: 'current', current: true, lastSeenAt: '2026-05-01T00:00:00.000Z' },
    { id: 'new', lastSeenAt: '2026-05-13T00:00:00.000Z' }
  ]);
  assert.deepEqual(sorted.map((device) => device.id), ['current', 'new', 'old']);
});

test('device status and meta text are human readable', () => {
  assert.equal(deviceStatusText({ current: true }), '当前设备');
  assert.equal(deviceStatusText({}), '已信任');
  assert.match(deviceMetaText({
    lastRemoteAddress: '192.168.1.23',
    lastSeenAt: '2026-05-14T12:00:00.000Z',
    lastUserAgent: 'Mobile Safari (iPhone)'
  }), /192\.168\.1\.23/);
});
