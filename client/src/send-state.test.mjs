/**
 * 测试 send-state.js：Composer 发送禁用态与桌面桥模式文案。
 * Keywords: send-state, composer, tests
 * Exports: 无导出 / 内含用例
 * Inward: send-state.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { composerSendState } from './send-state.js';

test('composerSendState allows mobile headless sending when the desktop bridge is unavailable', () => {
  const state = composerSendState({
    hasInput: true,
    desktopBridge: { connected: false, mode: 'unavailable' }
  });

  assert.equal(state.disabled, false);
  assert.equal(state.mode, 'start');
  assert.equal(state.label, '发送消息');
});

test('composerSendState starts a turn when idle', () => {
  const state = composerSendState({
    hasInput: true,
    desktopBridge: { connected: true, mode: 'desktop-proxy', capabilities: { createThread: true } },
    sessionIsDraft: true
  });

  assert.equal(state.disabled, false);
  assert.equal(state.mode, 'start');
  assert.equal(state.showMenu, false);
});

test('composerSendState shows submitting before the server accepts the turn', () => {
  const state = composerSendState({
    hasInput: false,
    submitting: true,
    desktopBridge: { connected: true, mode: 'desktop-ipc' }
  });

  assert.equal(state.disabled, true);
  assert.equal(state.mode, 'submitting');
  assert.equal(state.label, '发送中');
});

test('composerSendState defaults running input to steer when possible', () => {
  const state = composerSendState({
    running: true,
    hasInput: true,
    steerable: true,
    desktopBridge: { connected: true, mode: 'desktop-proxy' }
  });

  assert.equal(state.mode, 'steer');
  assert.equal(state.label, '选择发送方式');
  assert.equal(state.showMenu, true);
  assert.equal(state.canSteer, true);
});

test('composerSendState preserves queue and interrupt when active turn cannot steer', () => {
  const state = composerSendState({
    running: true,
    hasInput: true,
    steerable: false,
    desktopBridge: { connected: true, mode: 'desktop-proxy' }
  });

  assert.equal(state.mode, 'queue');
  assert.equal(state.canSteer, false);
  assert.equal(state.canQueue, true);
  assert.equal(state.canInterrupt, true);
});

test('composerSendState allows draft sends through headless when desktop direct creation is unavailable', () => {
  const state = composerSendState({
    hasInput: true,
    sessionIsDraft: true,
    desktopBridge: {
      connected: true,
      mode: 'desktop-ipc',
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }
  });

  assert.equal(state.disabled, false);
  assert.equal(state.mode, 'start');
});

test('composerSendState still allows existing desktop threads when createThread is unavailable', () => {
  const state = composerSendState({
    hasInput: true,
    sessionIsDraft: false,
    desktopBridge: {
      connected: true,
      mode: 'desktop-ipc',
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }
  });

  assert.equal(state.disabled, false);
  assert.equal(state.mode, 'start');
});

test('composerSendState allows draft sends in headless local mode', () => {
  const state = composerSendState({
    hasInput: true,
    sessionIsDraft: true,
    desktopBridge: {
      connected: true,
      mode: 'headless-local',
      capabilities: { createThread: true }
    }
  });

  assert.equal(state.disabled, false);
  assert.equal(state.mode, 'start');
});

test('composerSendState allows draft sends through desktop background fallback', () => {
  const state = composerSendState({
    hasInput: true,
    sessionIsDraft: true,
    desktopBridge: {
      connected: true,
      mode: 'desktop-ipc',
      capabilities: {
        createThread: false,
        backgroundCodex: true,
        createThreadViaBackground: true
      }
    }
  });

  assert.equal(state.disabled, false);
  assert.equal(state.mode, 'start');
});
