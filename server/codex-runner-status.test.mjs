/**
 * 测试 server/codex-runner.js：状态标签、消息阶段与回合完成判定辅助。
 *
 * Keywords: codex-runner, test, status, phase
 *
 * Exports: 无导出，内含用例
 *
 * Inward: codex-runner.js
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appServerAgentMessagePhase,
  isActiveWriterError,
  runCodexTurn,
  shouldCompleteTurnFromAppServerItem,
  statusLabel
} from './codex-runner.js';

test('statusLabel uses mobile-friendly command labels', () => {
  assert.equal(statusLabel('command_execution', 'running'), '正在处理本地任务');
  assert.equal(statusLabel('command_execution', 'completed'), '本地任务已处理');
  assert.equal(statusLabel('command_execution', 'failed'), '本地任务失败');
});

test('statusLabel uses mobile-friendly tool and file labels', () => {
  assert.equal(statusLabel('mcp_tool_call', 'running'), '正在完成一步操作');
  assert.equal(statusLabel('mcp_tool_call', 'completed'), '已完成一步操作');
  assert.equal(statusLabel('file_change', 'running'), '正在更新文件');
  assert.equal(statusLabel('file_change', 'completed'), '文件已更新');
});

test('completed final assistant item can finish a headless turn without turn completed notification', () => {
  assert.equal(
    shouldCompleteTurnFromAppServerItem('item/completed', {
      type: 'agentMessage',
      phase: 'final_answer',
      status: 'completed',
      text: '处理完成'
    }),
    true
  );
  assert.equal(
    shouldCompleteTurnFromAppServerItem('item/completed', {
      type: 'agentMessage',
      phase: 'commentary',
      status: 'completed',
      text: '正在处理'
    }),
    false
  );
  assert.equal(
    shouldCompleteTurnFromAppServerItem('item/started', {
      type: 'agentMessage',
      phase: 'final_answer',
      text: '还在输出'
    }),
    false
  );
});

test('appServerAgentMessagePhase uses delta params before cached item metadata', () => {
  assert.equal(
    appServerAgentMessagePhase({
      itemId: 'message-1',
      phase: 'commentary'
    }),
    'commentary'
  );
  assert.equal(
    appServerAgentMessagePhase({
      item: {
        id: 'message-1',
        phase: 'final_answer'
      }
    }),
    'final_answer'
  );
});

test('appServerAgentMessagePhase falls back to cached item phase for agent message deltas', () => {
  const state = {
    items: new Map([
      ['message-1', { id: 'message-1', type: 'agentMessage', phase: 'commentary' }]
    ])
  };

  assert.equal(
    appServerAgentMessagePhase({ itemId: 'message-1' }, state, 'message-1'),
    'commentary'
  );
  assert.equal(
    appServerAgentMessagePhase({ itemId: 'message-2' }, state, 'message-2'),
    ''
  );
});

test('active writer errors are recognized without treating unrelated failures as writer conflicts', () => {
  assert.equal(
    isActiveWriterError(new Error('thread abc already has an active writer')),
    true
  );
  assert.equal(isActiveWriterError(new Error('thread abc not found')), false);
});

test('runCodexTurn starts a new thread when resuming an active-writer thread', async () => {
  const events = [];
  let notificationHandler = null;
  const client = {
    closed: new Promise(() => {}),
    async request(method) {
      if (method === 'thread/resume') {
        throw new Error('thread old-thread already has an active writer');
      }
      if (method === 'thread/start') {
        return { thread: { id: 'new-thread', cwd: '/tmp/project', path: '/tmp/new-thread.jsonl' } };
      }
      if (method === 'turn/start') {
        notificationHandler({ method: 'turn/started', params: { turn: { id: 'app-turn-1' } } });
        notificationHandler({ method: 'turn/completed', params: { turn: { id: 'app-turn-1' } } });
        return { turn: { id: 'app-turn-1' } };
      }
      throw new Error(`unexpected method: ${method}`);
    },
    close() {}
  };

  const sessionId = await runCodexTurn({
    sessionId: 'old-thread',
    projectPath: '/tmp/project',
    message: '测试 active writer 恢复',
    turnId: 'mobile-turn-1',
    createAppServerClient: async (options) => {
      notificationHandler = options.onNotification;
      return client;
    }
  }, (payload) => events.push(payload));

  assert.equal(sessionId, 'new-thread');
  assert.equal(events.find((event) => event.type === 'thread-started')?.sessionId, 'new-thread');
  assert.equal(events.find((event) => event.type === 'thread-started')?.previousSessionId, 'old-thread');
  assert.equal(events.find((event) => event.type === 'thread-started')?.threadFallback, true);
  assert.equal(events.find((event) => event.type === 'chat-complete')?.sessionId, 'new-thread');
});
