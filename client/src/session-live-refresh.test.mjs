/**
 * 测试 session-live-refresh.js：选中会话消息补账合并与重命名写回。
 * Keywords: session-refresh, merge, tests
 * Exports: 无导出 / 内含用例
 * Inward: session-live-refresh.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySessionRenameToProjectSessions,
  hasStaleRunningActivityResolvedByLoaded,
  mergeLiveSelectedThreadMessages
} from './session-live-refresh.js';

test('mergeLiveSelectedThreadMessages prefers loaded snapshot over local-only user bubbles', () => {
  const current = [
    { id: 'local-1', role: 'user', content: 'hello', timestamp: '2026-05-13T00:00:00.000Z' }
  ];
  const loaded = [];

  assert.deepEqual(mergeLiveSelectedThreadMessages(current, loaded), loaded);
});

test('mergeLiveSelectedThreadMessages switches to loaded messages once user exists there', () => {
  const current = [
    { id: 'local-1', role: 'user', content: 'hello', timestamp: '2026-05-13T00:00:00.000Z' }
  ];
  const loaded = [
    { id: 'u1', role: 'user', content: 'hello', timestamp: '2026-05-13T00:00:01.000Z' },
    { id: 'a1', role: 'assistant', content: 'done', timestamp: '2026-05-13T00:00:02.000Z' }
  ];

  assert.deepEqual(mergeLiveSelectedThreadMessages(current, loaded), loaded);
});

test('mergeLiveSelectedThreadMessages keeps server message order without appending local user bubbles', () => {
  const current = [
    { id: 'u1', role: 'user', content: '上一条', timestamp: '2026-05-13T00:00:00.000Z' },
    { id: 'a1', role: 'assistant', content: '上一条回复', timestamp: '2026-05-13T00:00:01.000Z' },
    { id: 'local-2', role: 'user', content: '新消息', timestamp: '2026-05-13T00:00:05.000Z' }
  ];
  const loaded = [
    { id: 'u1', role: 'user', content: '上一条', timestamp: '2026-05-13T00:00:00.000Z' },
    { id: 'a1', role: 'assistant', content: '上一条回复', timestamp: '2026-05-13T00:00:04.000Z' }
  ];

  const merged = mergeLiveSelectedThreadMessages(current, loaded);
  assert.deepEqual(merged.map((message) => message.id), ['u1', 'a1']);
});

test('mergeLiveSelectedThreadMessages keeps running local activity while loaded stream is incomplete', () => {
  const current = [
    { id: 'u1', role: 'user', content: 'run', turnId: 'turn-1', timestamp: '2026-05-13T00:00:00.000Z' },
    { id: 'status-turn-1', role: 'activity', status: 'running', kind: 'turn', turnId: 'turn-1', timestamp: '2026-05-13T00:00:01.000Z' }
  ];
  const loaded = [
    { id: 'u1', role: 'user', content: 'run', turnId: 'turn-1', timestamp: '2026-05-13T00:00:00.000Z' }
  ];

  const merged = mergeLiveSelectedThreadMessages(current, loaded);
  assert.equal(merged.some((message) => message.role === 'activity' && message.status === 'running'), true);
});

test('mergeLiveSelectedThreadMessages dedupes activity cards by client turn id across refresh', () => {
  const current = [
    {
      id: 'status-client-turn',
      role: 'activity',
      status: 'running',
      turnId: 'client-turn',
      clientTurnId: 'client-turn',
      sessionId: 'thread-1',
      timestamp: '2026-05-13T00:00:01.000Z'
    }
  ];
  const loaded = [
    {
      id: 'activity-real-turn',
      role: 'activity',
      status: 'running',
      turnId: 'real-turn',
      clientTurnId: 'client-turn',
      sessionId: 'thread-1',
      timestamp: '2026-05-13T00:00:02.000Z',
      activities: [{ id: 'exec-1', kind: 'command_execution', status: 'running' }]
    }
  ];

  const merged = mergeLiveSelectedThreadMessages(current, loaded);
  assert.deepEqual(merged.map((message) => message.id), ['activity-real-turn']);
});

test('mergeLiveSelectedThreadMessages coalesces loaded and live activity cards for one running session', () => {
  const current = [
    { id: 'u1', role: 'user', content: 'run', sessionId: 'thread-1', timestamp: '2026-05-14T03:40:00.000Z' },
    {
      id: 'activity-live',
      role: 'activity',
      status: 'running',
      sessionId: 'thread-1',
      turnId: 'headless-turn-1',
      timestamp: '2026-05-14T03:40:20.000Z',
      activities: [{ id: 'cmd-2', kind: 'command_execution', status: 'running', label: '正在运行命令' }]
    }
  ];
  const loaded = [
    { id: 'u1', role: 'user', content: 'run', sessionId: 'thread-1', timestamp: '2026-05-14T03:40:00.000Z' },
    {
      id: 'activity-loaded',
      role: 'activity',
      status: 'completed',
      sessionId: 'thread-1',
      turnId: 'desktop-turn-1',
      timestamp: '2026-05-14T03:40:01.000Z',
      activities: [{ id: 'commentary-1', kind: 'agent_message', status: 'completed', label: '先查目录。' }]
    }
  ];

  const merged = mergeLiveSelectedThreadMessages(current, loaded);
  const activities = merged.filter((message) => message.role === 'activity');
  assert.equal(activities.length, 1);
  assert.equal(activities[0].id, 'activity-live');
  assert.equal(activities[0].status, 'running');
  assert.equal(activities[0].turnId, 'headless-turn-1');
  assert.deepEqual(
    activities[0].activities.map((activity) => activity.id),
    ['commentary-1', 'cmd-2']
  );
});

test('mergeLiveSelectedThreadMessages can drop stale desktop running activity after final reply arrives', () => {
  const current = [
    { id: 'u-local', role: 'user', content: 'run', sessionId: 'thread-1', timestamp: '2026-05-13T00:00:00.000Z' },
    {
      id: 'status-client-turn',
      role: 'activity',
      status: 'running',
      source: 'desktop-ipc',
      sessionId: 'thread-1',
      turnId: 'client-turn-1',
      timestamp: '2026-05-13T00:00:01.000Z'
    }
  ];
  const loaded = [
    { id: 'u-desktop', role: 'user', content: 'run', sessionId: 'thread-1', turnId: 'desktop-turn-1', timestamp: '2026-05-13T00:00:02.000Z' },
    { id: 'a-desktop', role: 'assistant', content: 'done', sessionId: 'thread-1', turnId: 'desktop-turn-1', timestamp: '2026-05-13T00:00:03.000Z' }
  ];

  const merged = mergeLiveSelectedThreadMessages(current, loaded, { forceDropStaleRunning: true });
  assert.deepEqual(merged, loaded);
  assert.equal(hasStaleRunningActivityResolvedByLoaded(current, loaded), true);
});

test('applySessionRenameToProjectSessions patches the loaded sidebar session in place', () => {
  const renamed = applySessionRenameToProjectSessions({
    project1: [
      { id: 'thread-1', title: '旧标题', projectId: 'project1' }
    ]
  }, {
    projectId: 'project1',
    sessionId: 'thread-1',
    title: '新标题',
    updatedAt: '2026-05-13T00:01:00.000Z'
  });

  assert.equal(renamed.project1[0].title, '新标题');
  assert.equal(renamed.project1[0].updatedAt, '2026-05-13T00:01:00.000Z');
});
