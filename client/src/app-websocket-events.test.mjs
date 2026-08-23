/**
 * 测试 app/useAppWebSocket.js：各类 WS 载荷是否应刷新线程或渲染本地消息。
 * Keywords: websocket, payload-guards, tests
 * Exports: 无导出 / 内含用例
 * Inward: app/useAppWebSocket.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coalesceSyncPayloads,
  projectShellsFromSyncProjects,
  selectedSessionHasLiveAuthority,
  sessionsByProjectFromSyncProjects,
  shouldCompleteLocalTurnBeforeRefresh,
  shouldRefreshDesktopThreadForPayload,
  shouldRefreshCurrentSessionAfterReconnect,
  shouldRenderActivityMessageForPayload,
  shouldRenderAssistantMessageForPayload,
  shouldRenderStatusMessageForPayload,
  websocketReconnectDelayMs
} from './app/useAppWebSocket.js';

test('desktop IPC status updates render through the same live path', () => {
  assert.equal(
    shouldRenderStatusMessageForPayload({
      type: 'status-update',
      source: 'desktop-ipc',
      kind: 'turn',
      status: 'running'
    }),
    false
  );
});

test('legacy status updates never render directly after sync rewrite', () => {
  assert.equal(
    shouldRenderStatusMessageForPayload({
      type: 'status-update',
      source: 'desktop-ipc',
      kind: 'turn',
      status: 'completed'
    }),
    false
  );
  assert.equal(
    shouldRenderStatusMessageForPayload({
      type: 'status-update',
      source: 'headless-local',
      kind: 'turn',
      status: 'running'
    }),
    false
  );
  assert.equal(
    shouldRenderStatusMessageForPayload({
      type: 'status-update',
      source: 'headless-local',
      kind: 'reasoning',
      status: 'running'
    }),
    false
  );
});

test('terminal events no longer trigger desktop-thread refresh path', () => {
  assert.equal(
    shouldRefreshDesktopThreadForPayload({
      type: 'chat-complete',
      source: 'desktop-ipc'
    }),
    false
  );
  assert.equal(
    shouldRefreshDesktopThreadForPayload({
      type: 'status-update',
      source: 'desktop-ipc',
      kind: 'turn',
      status: 'completed'
    }),
    false
  );
  assert.equal(
    shouldRefreshDesktopThreadForPayload({
      type: 'chat-complete',
      source: 'headless-local'
    }),
    false
  );
  assert.equal(
    shouldCompleteLocalTurnBeforeRefresh({
      type: 'chat-complete',
      source: 'desktop-ipc'
    }),
    false
  );
  assert.equal(
    shouldCompleteLocalTurnBeforeRefresh({
      type: 'status-update',
      source: 'desktop-ipc',
      kind: 'turn',
      status: 'completed'
    }),
    false
  );
  assert.equal(
    shouldCompleteLocalTurnBeforeRefresh({
      type: 'status-update',
      source: 'desktop-ipc',
      kind: 'turn',
      status: 'failed'
    }),
    false
  );
});

test('legacy activity and assistant updates no longer render directly', () => {
  assert.equal(
    shouldRenderActivityMessageForPayload({
      type: 'activity-update',
      source: 'headless-local',
      status: 'running'
    }),
    false
  );
  assert.equal(
    shouldRenderAssistantMessageForPayload({
      type: 'assistant-update',
      source: 'headless-local',
      content: '完成'
    }),
    false
  );
  assert.equal(
    shouldRenderActivityMessageForPayload({
      type: 'activity-update',
      status: 'running'
    }),
    false
  );
});

test('websocket reconnect refresh skips drafts and restores real selected sessions', () => {
  assert.equal(shouldRefreshCurrentSessionAfterReconnect({ id: 'thread-1' }), true);
  assert.equal(shouldRefreshCurrentSessionAfterReconnect({ id: 'draft-project-1' }), false);
  assert.equal(shouldRefreshCurrentSessionAfterReconnect(null), false);
});

test('websocket reconnect backs off after repeated transport failures', () => {
  assert.equal(websocketReconnectDelayMs(1), 1_000);
  assert.equal(websocketReconnectDelayMs(2), 2_000);
  assert.equal(websocketReconnectDelayMs(5), 15_000);
  assert.equal(websocketReconnectDelayMs(99), 15_000);
});

test('sync-state project snapshots keep session lists available to the app shell', () => {
  const projects = [{
    id: 'project-1',
    name: 'CodexMobile',
    sessionCount: 1,
    sessions: [{ id: 'thread-1', summary: '手机测试7' }]
  }];

  assert.deepEqual(projectShellsFromSyncProjects(projects), [{
    id: 'project-1',
    name: 'CodexMobile',
    sessionCount: 1
  }]);
  assert.deepEqual(sessionsByProjectFromSyncProjects(projects), {
    'project-1': [{ id: 'thread-1', summary: '手机测试7', projectId: 'project-1' }]
  });
});

test('coalesceSyncPayloads keeps only the latest assistant delta for the same turn/message', () => {
  const payloads = coalesceSyncPayloads([
    {
      type: 'sync-event',
      event: {
        eventType: 'message.assistant.delta',
        sessionId: 'thread-1',
        turnId: 'turn-1',
        message: { id: 'assistant-1', content: '第1段' }
      }
    },
    {
      type: 'sync-event',
      event: {
        eventType: 'message.assistant.delta',
        sessionId: 'thread-1',
        turnId: 'turn-1',
        message: { id: 'assistant-1', content: '第2段' }
      }
    },
    {
      type: 'sync-event',
      event: {
        eventType: 'message.assistant.completed',
        sessionId: 'thread-1',
        turnId: 'turn-1',
        message: { id: 'assistant-1', content: '最终完成' }
      }
    }
  ]);

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].event.message.content, '第2段');
  assert.equal(payloads[1].event.eventType, 'message.assistant.completed');
});

test('selectedSessionHasLiveAuthority prefers live runtime over snapshot refresh', () => {
  assert.equal(
    selectedSessionHasLiveAuthority(
      { id: 'thread-1', turnId: 'turn-1' },
      {},
      { 'thread-1': { status: 'running', sessionId: 'thread-1', turnId: 'turn-1' } }
    ),
    true
  );
  assert.equal(
    selectedSessionHasLiveAuthority(
      { id: 'thread-1', turnId: 'turn-1' },
      { 'turn-1': true },
      {}
    ),
    true
  );
  assert.equal(
    selectedSessionHasLiveAuthority(
      { id: 'thread-1', turnId: 'turn-1' },
      {},
      { 'thread-1': { status: 'completed', sessionId: 'thread-1', turnId: 'turn-1' } }
    ),
    false
  );
});
