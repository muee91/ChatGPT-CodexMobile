/**
 * 测试 server/desktop-refresh.js：桌面 Codex.app 自动 route bounce 与手动重启接续。
 *
 * Keywords: desktop-refresh, tests, Codex.app, route-bounce, desktop-handoff
 *
 * Exports: 无导出，内含用例
 *
 * Inward: desktop-refresh.js
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  configureDesktopRefresh,
  getDesktopRefreshPublicState,
  openDesktopThread,
  setDesktopRefreshEnabled,
  triggerDesktopRefreshForThread
} from './desktop-refresh.js';

test('desktop refresh is off by default and does not execute route bounce', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-desktop-refresh-off-'));
  const calls = [];
  configureDesktopRefresh({
    rootDir,
    platform: 'darwin',
    executor: async (step) => calls.push(step),
    sleep: async () => {}
  });

  assert.deepEqual(getDesktopRefreshPublicState(), {
    enabled: false,
    supported: true,
    experimental: true,
    mode: 'completion',
    lastTriggeredAt: null,
    lastError: null
  });

  const result = await triggerDesktopRefreshForThread('thread-1', { reason: 'test' });
  assert.equal(result.triggered, false);
  assert.equal(result.method, 'deep-link-direct');
  assert.equal(result.reason, 'desktop-refresh-disabled');
  assert.deepEqual(calls, []);
});

test('desktop refresh persists setting and tries direct deep link before fallback bounce', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-desktop-refresh-on-'));
  const calls = [];
  configureDesktopRefresh({
    rootDir,
    platform: 'darwin',
    executor: async (step) => calls.push(step),
    sleep: async () => {}
  });

  assert.equal(setDesktopRefreshEnabled(true).enabled, true);
  const result = await triggerDesktopRefreshForThread('thread-abc', { reason: 'background-thread-completed' });

  assert.equal(result.triggered, true);
  assert.equal(result.method, 'deep-link-direct');
  assert.equal(result.targetUrl, 'codex://threads/thread-abc');
  assert.deepEqual(calls.map((step) => step.url), ['codex://threads/thread-abc']);

  configureDesktopRefresh({
    rootDir,
    platform: 'darwin',
    executor: async () => {},
    sleep: async () => {}
  });
  assert.equal(getDesktopRefreshPublicState().enabled, true);
});

test('desktop refresh falls back to route bounce when direct deep link fails', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-desktop-refresh-fallback-'));
  const calls = [];
  let directFailed = false;
  configureDesktopRefresh({
    rootDir,
    platform: 'darwin',
    executor: async (step) => {
      calls.push(step);
      if (step.phase === 'direct' && !directFailed) {
        directFailed = true;
        throw new Error('direct failed');
      }
    },
    sleep: async () => {}
  });

  setDesktopRefreshEnabled(true);
  const result = await triggerDesktopRefreshForThread('thread-fallback', { reason: 'background-thread-completed' });

  assert.equal(result.triggered, true);
  assert.equal(result.method, 'deep-link-bounce');
  assert.deepEqual(calls.map((step) => step.phase), ['direct', 'bounce', 'target']);
});

test('manual desktop handoff restarts Codex.app before opening the target thread', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-desktop-handoff-'));
  const calls = [];
  configureDesktopRefresh({
    rootDir,
    platform: 'darwin',
    executor: async (step) => calls.push(step),
    sleep: async () => {}
  });

  const result = await openDesktopThread('thread-handoff', { reason: 'manual-handoff' });

  assert.equal(result.triggered, true);
  assert.equal(result.restarted, true);
  assert.equal(result.method, 'manual-restart');
  assert.equal(result.targetUrl, 'codex://threads/thread-handoff');
  assert.deepEqual(calls.map((step) => step.phase), ['quit', 'target']);
  assert.deepEqual(calls.map((step) => step.url || ''), ['', 'codex://threads/thread-handoff']);
});
