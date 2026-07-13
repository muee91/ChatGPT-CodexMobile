/**
 * 测试 client/src/desktop-handoff-state.js：顶部菜单“回到桌面继续”的可用态。
 * Keywords: desktop-handoff, topbar, tests
 * Exports: 无导出 / 内含用例
 * Inward: desktop-handoff-state.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopHandoffMenuState } from './desktop-handoff-state.js';

test('desktopHandoffMenuState allows completed existing sessions', () => {
  const state = desktopHandoffMenuState({
    selectedSession: { id: 'thread-1' },
    selectedRuntime: { status: 'completed' },
    supported: true
  });

  assert.equal(state.disabled, false);
  assert.equal(state.label, '回到桌面继续');
});

test('desktopHandoffMenuState disables handoff while the selected session is running', () => {
  const state = desktopHandoffMenuState({
    selectedSession: { id: 'thread-1' },
    selectedRuntime: { status: 'running' },
    supported: true
  });

  assert.equal(state.disabled, true);
  assert.equal(state.label, '执行完成后回到桌面');
  assert.match(state.reason, /执行中/);
});
