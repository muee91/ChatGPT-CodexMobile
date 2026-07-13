/**
 * 测试 panels/topbar-status.js：bridgeConnectionLabel 各连接与 runtime 组合。
 * Keywords: topbar, bridge, tests
 * Exports: 无导出 / 内含用例
 * Inward: panels/topbar-status.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgeConnectionLabel } from './panels/topbar-status.js';

test('bridgeConnectionLabel shows idle desktop IPC as mirror-only sync', () => {
  const label = bridgeConnectionLabel('connected', {
    connected: true,
    mode: 'desktop-ipc'
  }, {
    selectedSession: { id: 'thread-1' }
  });

  assert.equal(label.label, '已同步');
  assert.match(label.description, /普通对话可走后台 Codex/);
  assert.match(label.description, /项目会话需要可接管的桌面线程/);
});

test('bridgeConnectionLabel shows runtime channel instead of activity summary', () => {
  const desktop = bridgeConnectionLabel('connected', { connected: true, mode: 'desktop-ipc' }, {
    selectedSession: { id: 'thread-1' },
    selectedRuntime: { status: 'running', source: 'desktop-ipc', label: '正在思考' }
  });
  const headless = bridgeConnectionLabel('connected', { connected: true, mode: 'desktop-ipc' }, {
    selectedSession: { id: 'thread-1' },
    selectedRuntime: { status: 'running', source: 'headless-local', label: '正在搜索文件' }
  });

  assert.equal(desktop.label, '桌面端运行中');
  assert.match(desktop.className, /is-thread-ipc/);
  assert.equal(headless.label, '正在后台运行 Codex');
  assert.match(headless.className, /is-headless/);
});

test('bridgeConnectionLabel avoids claiming IPC route before running source is known', () => {
  const label = bridgeConnectionLabel('connected', { connected: true, mode: 'desktop-ipc' }, {
    selectedSession: { id: 'thread-1' },
    selectedRuntime: { status: 'running' }
  });

  assert.equal(label.label, '正在运行 Codex');
  assert.match(label.description, /等待 sync runtime/);
});

test('bridgeConnectionLabel switches queued and failure channel labels', () => {
  assert.equal(
    bridgeConnectionLabel('connected', { connected: true, mode: 'desktop-ipc' }, {
      selectedRuntime: { status: 'queued', source: 'local-optimistic', label: '消息发送中' }
    }).label,
    '消息发送中'
  );
  assert.equal(
    bridgeConnectionLabel('connected', { connected: true, mode: 'desktop-ipc' }, {
      selectedRuntime: { status: 'queued', source: 'headless-local' }
    }).label,
    '后台排队中'
  );
  assert.equal(
    bridgeConnectionLabel('connected', { connected: true, mode: 'desktop-ipc' }, {
      selectedRuntime: { status: 'failed', source: 'headless-local', label: '工具调用失败' }
    }).label,
    '后台 Codex 运行失败'
  );
});

test('bridgeConnectionLabel falls back to idle bridge label after completed runtime notice', () => {
  assert.equal(
    bridgeConnectionLabel('connected', { connected: true, mode: 'desktop-ipc' }, {
      selectedSession: { id: 'thread-1' },
      selectedRuntime: { status: 'completed', source: 'headless-local' }
    }).label,
    '已同步'
  );
});

test('bridgeConnectionLabel uses compact background and disconnected labels', () => {
  assert.equal(
    bridgeConnectionLabel('connected', { connected: true, mode: 'headless-local' }).label,
    '后台可用'
  );

  assert.equal(
    bridgeConnectionLabel('disconnected', null).label,
    '未连接'
  );
});
