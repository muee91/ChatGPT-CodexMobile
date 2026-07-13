/**
 * 测试 chat/chat-render-items.js：运行中过程投影与文件变更汇总。
 * Keywords: chat-render, process-stream, file-summary, tests
 * Exports: 无导出 / 内含用例
 * Inward: chat/chat-render-items.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chatRenderItems,
  fileSummaryForActivityMessage
} from './chat/chat-render-items.js';

const fileChangeActivity = {
  id: 'activity-1',
  role: 'activity',
  turnId: 'turn-1',
  status: 'completed',
  activities: [
    {
      id: 'patch-1',
      kind: 'file_change',
      status: 'completed',
      fileChanges: [
        {
          path: 'client/src/chat/ActivityMessage.jsx',
          kind: 'update',
          additions: 2,
          deletions: 1,
          unifiedDiff: '@@\n-old\n+new\n+again'
        }
      ]
    }
  ]
};

test('chatRenderItems attaches completed file summary below the assistant result', () => {
  const items = chatRenderItems([
    { id: 'user-1', role: 'user', turnId: 'turn-1', content: '修一下' },
    fileChangeActivity,
    { id: 'answer-1', role: 'assistant', turnId: 'turn-1', content: '改好了' }
  ]);

  assert.deepEqual(items.map((item) => [item.type, item.message?.role || 'fileSummary']), [
    ['message', 'user'],
    ['message', 'activity'],
    ['message', 'assistant']
  ]);
  assert.equal(items[2].fileSummaries.length, 1);
  assert.equal(items[2].fileSummaries[0].files[0].path, 'client/src/chat/ActivityMessage.jsx');
});

test('chatRenderItems repairs late completed activity order before the assistant result', () => {
  const items = chatRenderItems([
    { id: 'user-1', role: 'user', turnId: 'turn-1', content: '修一下' },
    { id: 'answer-1', role: 'assistant', turnId: 'turn-1', content: '改好了' },
    fileChangeActivity
  ]);

  assert.deepEqual(items.map((item) => [item.type, item.message?.role || 'fileSummary']), [
    ['message', 'user'],
    ['message', 'activity'],
    ['message', 'assistant']
  ]);
  assert.equal(items[2].fileSummaries.length, 1);
  assert.equal(items[2].fileSummaries[0].files[0].path, 'client/src/chat/ActivityMessage.jsx');
});

test('chatRenderItems attaches segmented activity file summary to a final assistant without segment index', () => {
  const items = chatRenderItems([
    { id: 'user-1', role: 'user', turnId: 'turn-1', content: '修一下' },
    { ...fileChangeActivity, id: 'activity-segment-1', segmentIndex: 1 },
    { id: 'answer-1', role: 'assistant', turnId: 'turn-1', content: '改好了' }
  ]);

  assert.deepEqual(items.map((item) => [item.type, item.message?.role || 'fileSummary']), [
    ['message', 'user'],
    ['message', 'activity'],
    ['message', 'assistant']
  ]);
  assert.equal(items[2].fileSummaries.length, 1);
});

test('chatRenderItems waits for the assistant result before showing a file summary', () => {
  const items = chatRenderItems([
    { id: 'user-1', role: 'user', turnId: 'turn-1', content: '修一下' },
    fileChangeActivity
  ]);

  assert.deepEqual(items.map((item) => item.type), ['message', 'message']);
});

test('fileSummaryForActivityMessage hides file cards while the activity is still running', () => {
  assert.equal(fileSummaryForActivityMessage({
    ...fileChangeActivity,
    status: 'running'
  }), null);
});

test('chatRenderItems renders the current runtime as one live progress item', () => {
  const items = chatRenderItems([
    { id: 'user-1', role: 'user', sessionId: 'thread-1', content: '跑任务' },
    {
      id: 'activity-loaded',
      role: 'activity',
      status: 'completed',
      sessionId: 'thread-1',
      turnId: 'desktop-turn-1',
      timestamp: '2026-05-14T03:40:01.000Z',
      activities: [
        { id: 'commentary-1', kind: 'agent_message', status: 'completed', label: '先查目录。' }
      ]
    },
    {
      id: 'activity-running',
      role: 'activity',
      status: 'running',
      sessionId: 'thread-1',
      turnId: 'headless-turn-1',
      timestamp: '2026-05-14T03:40:20.000Z',
      activities: [
        { id: 'cmd-1', kind: 'command_execution', status: 'running', label: '正在运行命令' }
      ]
    }
  ], { running: true });

  assert.deepEqual(items.map((item) => [item.type, item.message?.id]), [
    ['message', 'user-1'],
    ['liveActivity', 'activity-running']
  ]);
  assert.equal(items[1].message.status, 'running');
  assert.deepEqual(
    items[1].message.activities.map((activity) => activity.id),
    ['commentary-1', 'cmd-1']
  );
});

test('chatRenderItems merges multi-step current runtime into a single live progress item', () => {
  const items = chatRenderItems([
    { id: 'user-1', role: 'user', sessionId: 'thread-1', content: '继续跑任务' },
    {
      id: 'activity-step-1',
      role: 'activity',
      status: 'completed',
      sessionId: 'thread-1',
      segmentIndex: 0,
      activities: [
        { id: 'search-1', kind: 'web_search', status: 'completed', label: '搜索资料' }
      ]
    },
    {
      id: 'activity-step-2',
      role: 'activity',
      status: 'running',
      sessionId: 'thread-1',
      segmentIndex: 1,
      activities: [
        { id: 'cmd-1', kind: 'command_execution', status: 'running', label: '正在运行命令' }
      ]
    }
  ], { running: true });

  assert.deepEqual(items.map((item) => item.type), ['message', 'liveActivity']);
  assert.deepEqual(
    items[1].message.activities.map((activity) => activity.id),
    ['search-1', 'cmd-1']
  );
});

test('chatRenderItems keeps live timer anchored to the first visible activity step', () => {
  const items = chatRenderItems([
    { id: 'user-1', role: 'user', sessionId: 'thread-1', content: '继续跑任务' },
    {
      id: 'activity-turn-1-start',
      role: 'activity',
      status: 'completed',
      sessionId: 'thread-1',
      turnId: 'turn-1',
      startedAt: '2026-05-14T13:33:37.278Z',
      timestamp: '2026-05-14T13:33:37.278Z',
      activities: [
        {
          id: 'agent-1',
          kind: 'agent_message',
          status: 'completed',
          label: '继续跑一轮。',
          timestamp: '2026-05-14T13:33:37.278Z'
        }
      ]
    },
    {
      id: 'activity-turn-1-mid',
      role: 'activity',
      status: 'running',
      sessionId: 'thread-1',
      turnId: 'turn-1',
      startedAt: '2026-05-14T13:34:07.831Z',
      timestamp: '2026-05-14T13:34:07.831Z',
      activities: [
        {
          id: 'cmd-mid',
          kind: 'command_execution',
          status: 'running',
          label: '正在运行命令',
          timestamp: '2026-05-14T13:34:07.831Z'
        }
      ]
    }
  ], { running: true });

  assert.deepEqual(items.map((item) => item.type), ['message', 'liveActivity']);
  assert.equal(items[1].key, 'live-activity-turn-1');
  assert.equal(items[1].message.startedAt, '2026-05-14T13:33:37.278Z');
  assert.equal(items[1].message.timestamp, '2026-05-14T13:33:37.278Z');
});

test('chatRenderItems merges adjacent completed activity cards for the final archive', () => {
  const items = chatRenderItems([
    { id: 'user-1', role: 'user', sessionId: 'thread-1', content: '跑任务' },
    {
      id: 'activity-step-1',
      role: 'activity',
      status: 'completed',
      sessionId: 'thread-1',
      segmentIndex: 0,
      activities: [
        { id: 'search-1', kind: 'web_search', status: 'completed', label: '搜索资料' }
      ]
    },
    {
      id: 'activity-step-2',
      role: 'activity',
      status: 'completed',
      sessionId: 'thread-1',
      segmentIndex: 1,
      activities: [
        { id: 'cmd-1', kind: 'command_execution', status: 'completed', label: '运行命令' }
      ]
    },
    { id: 'answer-1', role: 'assistant', sessionId: 'thread-1', content: '完成了' }
  ]);

  assert.deepEqual(items.map((item) => [item.type, item.message?.role, item.message?.activities?.length || 0]), [
    ['message', 'user', 0],
    ['message', 'activity', 2],
    ['message', 'assistant', 0]
  ]);
});

test('chatRenderItems keeps earlier archives separate from the current live runtime', () => {
  const items = chatRenderItems([
    { id: 'user-1', role: 'user', sessionId: 'thread-1', content: '先跑一个任务' },
    {
      id: 'activity-previous',
      role: 'activity',
      status: 'completed',
      sessionId: 'thread-1',
      turnId: 'previous-turn',
      startedAt: '2026-05-14T03:20:00.000Z',
      completedAt: '2026-05-14T03:20:30.000Z',
      activities: [
        { id: 'old-cmd', kind: 'command_execution', status: 'completed', label: '旧任务完成' }
      ]
    },
    { id: 'answer-1', role: 'assistant', sessionId: 'thread-1', content: '完成了。' },
    { id: 'user-2', role: 'user', sessionId: 'thread-1', content: '继续跑一个任务' },
    {
      id: 'activity-running',
      role: 'activity',
      status: 'running',
      sessionId: 'thread-1',
      turnId: 'current-turn',
      startedAt: '2026-05-14T03:34:00.000Z',
      activities: [
        { id: 'new-cmd', kind: 'command_execution', status: 'running', label: '正在运行命令' }
      ]
    }
  ], { running: true });

  assert.deepEqual(items.map((item) => [item.type, item.message?.id]), [
    ['message', 'user-1'],
    ['message', 'activity-previous'],
    ['message', 'answer-1'],
    ['message', 'user-2'],
    ['liveActivity', 'activity-running']
  ]);
  assert.deepEqual(items.at(-1).message.activities.map((activity) => activity.id), ['new-cmd']);
});

test('chatRenderItems never renders a running activity as an archive card', () => {
  const items = chatRenderItems([
    { id: 'user-1', role: 'user', sessionId: 'thread-1', content: '跑一个任务' },
    {
      id: 'activity-running',
      role: 'activity',
      status: 'running',
      sessionId: 'thread-1',
      activities: [
        { id: 'cmd-1', kind: 'command_execution', status: 'running', label: '正在运行命令' }
      ]
    }
  ]);

  assert.deepEqual(items.map((item) => [item.type, item.message?.id]), [
    ['message', 'user-1'],
    ['liveActivity', 'activity-running']
  ]);
});

test('chatRenderItems keeps live progress stable when a guided user message arrives during runtime', () => {
  const items = chatRenderItems([
    { id: 'user-1', role: 'user', sessionId: 'thread-1', content: '跑一个任务' },
    {
      id: 'activity-before-guide',
      role: 'activity',
      status: 'completed',
      sessionId: 'thread-1',
      activities: [
        { id: 'check-1', kind: 'command_execution', status: 'completed', label: '检查环境' }
      ]
    },
    { id: 'user-2', role: 'user', kind: 'guided_user', guided: true, sessionId: 'thread-1', content: '继续跑' },
    {
      id: 'activity-after-guide',
      role: 'activity',
      status: 'running',
      sessionId: 'thread-1',
      activities: [
        { id: 'cmd-1', kind: 'command_execution', status: 'running', label: '正在运行命令' }
      ]
    }
  ], { running: true });

  assert.deepEqual(items.map((item) => [item.type, item.message?.id]), [
    ['message', 'user-1'],
    ['message', 'user-2'],
    ['liveActivity', 'activity-after-guide']
  ]);
  assert.deepEqual(
    items.at(-1).message.activities.map((activity) => activity.id),
    ['check-1', 'cmd-1']
  );
});
