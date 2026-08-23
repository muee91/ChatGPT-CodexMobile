/**
 * 测试 sync/useSyncSocket.js：统一同步事件如何确认用户消息并归并执行过程。
 * Keywords: sync-socket, user-message, pending, activity, commentary, tests
 * Exports: 无导出 / 内含用例
 * Inward: sync/useSyncSocket.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applySyncSocketPayload, shouldPromoteCurrentDraftToThread } from './sync/useSyncSocket.js';

function applyWithMessages(messages, event) {
  let nextMessages = messages;
  const scheduledRefreshes = [];
  const handled = applySyncSocketPayload({
    type: 'sync-event',
    event
  }, {
    selectedSessionRef: { current: { id: event.sessionId, turnId: event.clientTurnId } },
    setMessages(update) {
      nextMessages = update(nextMessages);
    },
    scheduleTurnRefresh(payload) {
      scheduledRefreshes.push(payload);
    }
  });
  return { handled, messages: nextMessages, scheduledRefreshes };
}

test('message.user confirms only the matching pending duplicate content message', () => {
  const current = [
    {
      id: 'old-user',
      role: 'user',
      content: '继续',
      sessionId: 'thread-1',
      turnId: 'old-turn',
      deliveryState: 'confirmed',
      timestamp: '2026-05-13T00:00:00.000Z'
    },
    {
      id: 'local-user',
      role: 'user',
      content: '继续',
      sessionId: 'thread-1',
      turnId: 'client-turn-2',
      deliveryState: 'pending',
      timestamp: '2026-05-13T00:01:00.000Z'
    }
  ];

  const result = applyWithMessages(current, {
    eventType: 'message.user',
    sessionId: 'thread-1',
    turnId: 'real-turn-2',
    clientTurnId: 'client-turn-2',
    message: {
      id: 'server-user',
      role: 'user',
      content: '继续',
      timestamp: '2026-05-13T00:01:01.000Z'
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].turnId, 'old-turn');
  assert.equal(result.messages[0].deliveryState, 'confirmed');
  assert.equal(result.messages[1].turnId, 'real-turn-2');
  assert.equal(result.messages[1].deliveryState, 'confirmed');
  assert.equal(result.messages[1].timestamp, '2026-05-13T00:01:01.000Z');
});

test('message.user reconciles the optimistic local confirmed bubble instead of appending a duplicate', () => {
  const current = [
    {
      id: 'local-user',
      role: 'user',
      content: '继续',
      sessionId: 'thread-1',
      turnId: 'client-turn-2',
      deliveryState: 'confirmed',
      timestamp: '2026-05-13T00:01:00.000Z'
    }
  ];

  const result = applyWithMessages(current, {
    eventType: 'message.user',
    sessionId: 'thread-1',
    turnId: 'real-turn-2',
    clientTurnId: 'client-turn-2',
    message: {
      id: 'server-user',
      role: 'user',
      content: '继续',
      timestamp: '2026-05-13T00:01:01.000Z'
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].id, 'server-user');
  assert.equal(result.messages[0].turnId, 'real-turn-2');
  assert.equal(result.messages[0].timestamp, '2026-05-13T00:01:01.000Z');
  assert.equal(result.scheduledRefreshes.length, 1);
  assert.equal(result.scheduledRefreshes[0].sessionId, 'thread-1');
  assert.equal(result.scheduledRefreshes[0].turnId, 'real-turn-2');
});

test('message.user appends a server bubble for the selected session when no local optimistic copy exists', () => {
  const result = applyWithMessages([], {
    eventType: 'message.user',
    sessionId: 'thread-1',
    turnId: 'real-turn-2',
    clientTurnId: 'client-turn-2',
    message: {
      id: 'server-user',
      role: 'user',
      content: '继续',
      timestamp: '2026-05-13T00:01:01.000Z'
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].id, 'server-user');
  assert.equal(result.messages[0].content, '继续');
  assert.equal(result.messages[0].turnId, 'real-turn-2');
  assert.equal(result.messages[0].deliveryState, 'confirmed');
  assert.equal(result.scheduledRefreshes.length, 1);
  assert.equal(result.scheduledRefreshes[0].sessionId, 'thread-1');
  assert.equal(result.scheduledRefreshes[0].turnId, 'real-turn-2');
});

test('message.user ignores a duplicate replay of the same confirmed server message id', () => {
  const current = [
    {
      id: 'server-user',
      role: 'user',
      content: '继续',
      sessionId: 'thread-1',
      turnId: 'real-turn-2',
      deliveryState: 'confirmed',
      timestamp: '2026-05-13T00:01:01.000Z'
    }
  ];

  const result = applyWithMessages(current, {
    eventType: 'message.user',
    sessionId: 'thread-1',
    turnId: 'real-turn-2',
    clientTurnId: 'client-turn-2',
    message: {
      id: 'server-user',
      role: 'user',
      content: '继续',
      timestamp: '2026-05-13T00:01:01.000Z'
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].id, 'server-user');
});

test('message.user ignores a duplicate replay matched by session turn and content when id is unstable', () => {
  const current = [
    {
      id: 'server-user-1',
      role: 'user',
      content: '继续',
      sessionId: 'thread-1',
      turnId: 'real-turn-2',
      deliveryState: 'confirmed',
      timestamp: '2026-05-13T00:01:01.000Z'
    }
  ];

  const result = applyWithMessages(current, {
    eventType: 'message.user',
    sessionId: 'thread-1',
    turnId: 'real-turn-2',
    clientTurnId: 'client-turn-2',
    message: {
      id: 'server-user-2',
      role: 'user',
      content: '继续',
      timestamp: '2026-05-13T00:01:02.000Z'
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].id, 'server-user-1');
});

test('message.user still refreshes a non-selected session preview instead of dropping the event', () => {
  let nextSessionsByProject = {
    'project-1': [
      {
        id: 'thread-2',
        projectId: 'project-1',
        title: '审计新UI后端版',
        summary: '旧摘要',
        updatedAt: '2026-05-13T00:00:00.000Z',
        messageCount: 1
      }
    ]
  };

  const handled = applySyncSocketPayload({
    type: 'sync-event',
    event: {
      eventType: 'message.user',
      projectId: 'project-1',
      sessionId: 'thread-2',
      turnId: 'real-turn-3',
      clientTurnId: 'client-turn-3',
      timestamp: '2026-05-13T00:02:01.000Z',
      message: {
        id: 'server-user',
        role: 'user',
        content: '这是手机发到别的会话的新消息',
        timestamp: '2026-05-13T00:02:01.000Z'
      }
    }
  }, {
    selectedSessionRef: { current: { id: 'thread-1', turnId: 'client-turn-1' } },
    setSessionsByProject(update) {
      nextSessionsByProject = update(nextSessionsByProject);
    },
    upsertSessionInProject(current = {}, projectId, session) {
      const existing = current[projectId] || [];
      return {
        ...current,
        [projectId]: [session, ...existing.filter((item) => item.id !== session.id)]
      };
    }
  });

  assert.equal(handled, true);
  assert.equal(nextSessionsByProject['project-1'][0].id, 'thread-2');
  assert.equal(nextSessionsByProject['project-1'][0].summary, '这是手机发到别的会话的新消息');
  assert.equal(nextSessionsByProject['project-1'][0].updatedAt, '2026-05-13T00:02:01.000Z');
  assert.equal(nextSessionsByProject['project-1'][0].messageCount, 2);
});

test('message.assistant.completed updates a non-selected session preview instead of rewriting current messages', () => {
  let nextSessionsByProject = {
    'project-1': [
      {
        id: 'thread-2',
        projectId: 'project-1',
        title: '后台线程',
        summary: '旧摘要',
        updatedAt: '2026-05-13T00:00:00.000Z',
        messageCount: 1
      }
    ]
  };
  let nextMessages = [
    { id: 'm-1', role: 'assistant', sessionId: 'thread-1', turnId: 'turn-1', content: '当前窗口内容' }
  ];

  const handled = applySyncSocketPayload({
    type: 'sync-event',
    event: {
      eventType: 'message.assistant.completed',
      projectId: 'project-1',
      sessionId: 'thread-2',
      turnId: 'turn-2',
      timestamp: '2026-05-13T00:03:00.000Z',
      message: {
        id: 'assistant-2',
        role: 'assistant',
        content: '后台线程新回复',
        timestamp: '2026-05-13T00:03:00.000Z',
        done: true
      }
    }
  }, {
    selectedSessionRef: { current: { id: 'thread-1', turnId: 'turn-1' } },
    setSessionsByProject(update) {
      nextSessionsByProject = update(nextSessionsByProject);
    },
    upsertSessionInProject(current = {}, projectId, session) {
      const existing = current[projectId] || [];
      return {
        ...current,
        [projectId]: [session, ...existing.filter((item) => item.id !== session.id)]
      };
    },
    setMessages(update) {
      nextMessages = typeof update === 'function' ? update(nextMessages) : update;
    }
  });

  assert.equal(handled, true);
  assert.equal(nextSessionsByProject['project-1'][0].summary, '后台线程新回复');
  assert.deepEqual(nextMessages, [
    { id: 'm-1', role: 'assistant', sessionId: 'thread-1', turnId: 'turn-1', content: '当前窗口内容' }
  ]);
});

test('commentary assistant deltas render inside the execution card instead of chat bubbles', () => {
  const result = applyWithMessages([], {
    eventType: 'message.assistant.delta',
    source: 'headless-local',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    status: 'running',
    message: {
      id: 'commentary-1',
      role: 'assistant',
      phase: 'commentary',
      content: '现在已经输出到第 5 行，继续等工具结果。',
      done: false,
      timestamp: '2026-05-13T00:02:00.000Z'
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].role, 'activity');
  assert.equal(result.messages[0].activities.length, 1);
  assert.equal(result.messages[0].activities[0].id, 'commentary-1');
  assert.equal(result.messages[0].activities[0].kind, 'agent_message');
  assert.equal(result.messages[0].activities[0].label, '现在已经输出到第 5 行，继续等工具结果。');
});

test('final answer assistant deltas still render as assistant chat bubbles', () => {
  const result = applyWithMessages([], {
    eventType: 'message.assistant.delta',
    source: 'headless-local',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    status: 'running',
    message: {
      id: 'answer-1',
      role: 'assistant',
      phase: 'final_answer',
      content: '最终回答正在输出。',
      done: false,
      timestamp: '2026-05-13T00:03:00.000Z'
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].role, 'assistant');
  assert.equal(result.messages[0].content, '最终回答正在输出。');
});

test('assistant delta never regresses visible text when a shorter stale chunk arrives later', () => {
  const first = applyWithMessages([], {
    eventType: 'message.assistant.delta',
    source: 'headless-local',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    status: 'running',
    message: {
      id: 'answer-1',
      role: 'assistant',
      phase: 'final_answer',
      content: '这是已经显示出来的一整段更长文本。',
      done: false
    }
  });
  const regressed = applyWithMessages(first.messages, {
    eventType: 'message.assistant.delta',
    source: 'headless-local',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    status: 'running',
    message: {
      id: 'answer-1',
      role: 'assistant',
      phase: 'final_answer',
      content: '这是较短文本。',
      done: false
    }
  });

  assert.equal(regressed.messages.length, 1);
  assert.equal(regressed.messages[0].role, 'assistant');
  assert.equal(regressed.messages[0].content, '这是已经显示出来的一整段更长文本。');
});

test('interaction sync events insert and resolve pending request messages', () => {
  const requested = applyWithMessages([], {
    eventType: 'interaction.requested',
    source: 'headless-local',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    status: 'pending',
    interaction: {
      id: 'interaction-1',
      kind: 'user_input',
      title: '检查方式',
      questions: [{ id: 'check_method', question: '怎么检查？', options: [] }]
    }
  });

  assert.equal(requested.handled, true);
  assert.equal(requested.messages.length, 1);
  assert.equal(requested.messages[0].role, 'interaction_request');
  assert.equal(requested.messages[0].interaction.title, '检查方式');

  const resolved = applyWithMessages(requested.messages, {
    eventType: 'interaction.resolved',
    source: 'headless-local',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    status: 'completed',
    interactionId: 'interaction-1'
  });

  assert.equal(resolved.handled, true);
  assert.deepEqual(resolved.messages, []);
});

test('commentary assistant event removes earlier same item assistant bubble', () => {
  const prematureBubble = applyWithMessages([], {
    eventType: 'message.assistant.delta',
    source: 'headless-local',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    status: 'running',
    message: {
      id: 'agent-message-1',
      role: 'assistant',
      phase: 'final_answer',
      content: '现在到第 7 次输出，工具 session 仍然保持运行。',
      done: false
    }
  });
  const commentary = applyWithMessages(prematureBubble.messages, {
    eventType: 'message.assistant.delta',
    source: 'headless-local',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    status: 'running',
    message: {
      id: 'agent-message-1',
      role: 'assistant',
      phase: 'commentary',
      content: '现在到第 7 次输出，工具 session 仍然保持运行。',
      done: false
    }
  });

  assert.equal(prematureBubble.messages.length, 1);
  assert.equal(prematureBubble.messages[0].role, 'assistant');
  assert.equal(commentary.messages.length, 1);
  assert.equal(commentary.messages[0].role, 'activity');
  assert.equal(commentary.messages[0].activities[0].label, '现在到第 7 次输出，工具 session 仍然保持运行。');
});

test('commentary activity event removes earlier same item assistant bubble', () => {
  const prematureBubble = applyWithMessages([], {
    eventType: 'message.assistant.delta',
    source: 'headless-local',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    status: 'running',
    message: {
      id: 'agent-message-2',
      role: 'assistant',
      phase: 'final_answer',
      content: '任务在跑，当前到第 3 次输出。',
      done: false
    }
  });
  const activity = applyWithMessages(prematureBubble.messages, {
    eventType: 'activity.updated',
    source: 'headless-local',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    activity: {
      sessionId: 'thread-1',
      turnId: 'turn-1',
      messageId: 'agent-message-2',
      itemId: 'agent-message-2',
      kind: 'agent_message',
      phase: 'commentary',
      status: 'running',
      label: '任务在跑，当前到第 3 次输出。',
      content: '任务在跑，当前到第 3 次输出。'
    }
  });

  assert.equal(activity.messages.length, 1);
  assert.equal(activity.messages[0].role, 'activity');
  assert.equal(activity.messages[0].activities.length, 1);
  assert.equal(activity.messages[0].activities[0].id, 'agent-message-2');
});

test('final completed answer folds prior commentary activity and keeps final bubble separate', () => {
  const commentary = applyWithMessages([], {
    eventType: 'message.assistant.delta',
    source: 'headless-local',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    status: 'running',
    message: {
      id: 'commentary-1',
      role: 'assistant',
      phase: 'commentary',
      content: '先看工具输出。',
      done: false,
      timestamp: '2026-05-13T00:04:00.000Z'
    }
  });

  const completed = applyWithMessages(commentary.messages, {
    eventType: 'message.assistant.completed',
    source: 'headless-local',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    status: 'completed',
    message: {
      id: 'answer-1',
      role: 'assistant',
      phase: 'final_answer',
      content: '最终回答。',
      done: true,
      timestamp: '2026-05-13T00:04:30.000Z'
    }
  });

  assert.equal(completed.messages.length, 2);
  assert.equal(completed.messages[0].role, 'activity');
  assert.equal(completed.messages[0].status, 'completed');
  assert.equal(completed.messages[0].activities[0].status, 'completed');
  assert.equal(completed.messages[1].role, 'assistant');
  assert.equal(completed.messages[1].content, '最终回答。');
  assert.equal(completed.scheduledRefreshes.length, 1);
  assert.equal(completed.scheduledRefreshes[0].sessionId, 'thread-1');
  assert.equal(completed.scheduledRefreshes[0].turnId, 'turn-1');
});

test('commentary and tool activity accumulate in one execution card during a turn', () => {
  const first = applyWithMessages([], {
    eventType: 'message.assistant.delta',
    source: 'headless-local',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    status: 'running',
    message: {
      id: 'commentary-1',
      role: 'assistant',
      phase: 'commentary',
      content: '先启动命令。',
      done: false
    }
  });
  const tool = applyWithMessages(first.messages, {
    eventType: 'activity.updated',
    source: 'headless-local',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    activity: {
      sessionId: 'thread-1',
      turnId: 'turn-1',
      messageId: 'cmd-1',
      kind: 'command_execution',
      status: 'running',
      label: '正在处理本地任务',
      command: 'sleep 5'
    }
  });
  const second = applyWithMessages(tool.messages, {
    eventType: 'message.assistant.delta',
    source: 'headless-local',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    status: 'running',
    message: {
      id: 'commentary-2',
      role: 'assistant',
      phase: 'commentary',
      content: '命令还在跑，继续等结果。',
      done: false
    }
  });

  assert.equal(second.messages.length, 1);
  assert.equal(second.messages[0].role, 'activity');
  assert.deepEqual(
    second.messages[0].activities.map((activity) => activity.kind),
    ['agent_message', 'command_execution', 'agent_message']
  );
});

test('thread.started does not steal selection from an unrelated draft in the same project', () => {
  const selectedSessionRef = {
    current: { id: 'draft-project-1-a', projectId: 'project-1', draft: true, title: '我正在输入' }
  };
  let nextSelected = selectedSessionRef.current;
  const result = applySyncSocketPayload({
    type: 'sync-event',
    event: {
      eventType: 'thread.started',
      projectId: 'project-1',
      sessionId: 'thread-2',
      previousSessionId: 'draft-project-1-b',
      turnId: 'turn-2',
      timestamp: '2026-05-26T14:30:00.000Z',
      session: { id: 'thread-2', projectId: 'project-1', title: '别的线程' }
    }
  }, {
    selectedProjectRef: { current: { id: 'project-1' } },
    selectedSessionRef,
    setSelectedSession(update) {
      nextSelected = typeof update === 'function' ? update(nextSelected) : update;
    },
    setSessionsByProject() {},
    upsertSessionInProject(current = {}, _projectId, _session) {
      return current;
    },
    setMessages(update) {
      void update([]);
    }
  });

  assert.equal(result, true);
  assert.equal(selectedSessionRef.current.id, 'draft-project-1-a');
  assert.equal(nextSelected.id, 'draft-project-1-a');
});

test('shouldPromoteCurrentDraftToThread only promotes the matching current draft', () => {
  assert.equal(shouldPromoteCurrentDraftToThread(
    { id: 'draft-1', projectId: 'project-1', draft: true, turnId: 'turn-1' },
    { sessionId: 'thread-1', previousSessionId: 'draft-1', turnId: 'turn-1' },
    'project-1'
  ), true);
  assert.equal(shouldPromoteCurrentDraftToThread(
    { id: 'draft-1', projectId: 'project-1', draft: true, turnId: 'turn-1' },
    { sessionId: 'thread-1', previousSessionId: 'draft-2', turnId: 'turn-1' },
    'project-1'
  ), false);
  assert.equal(shouldPromoteCurrentDraftToThread(
    { id: 'draft-1', projectId: 'project-1', draft: true, turnId: 'turn-1' },
    { sessionId: 'thread-1', previousSessionId: 'draft-1', turnId: 'turn-2' },
    'project-1'
  ), true);
});

test('shouldPromoteCurrentDraftToThread rejects non-draft or cross-project sessions even if ids match', () => {
  assert.equal(shouldPromoteCurrentDraftToThread(
    { id: 'draft-1', projectId: 'project-1', draft: false },
    { sessionId: 'thread-1', previousSessionId: 'draft-1' },
    'project-1'
  ), false);
  assert.equal(shouldPromoteCurrentDraftToThread(
    { id: 'thread-1', projectId: 'project-1', draft: false },
    { sessionId: 'thread-2', previousSessionId: 'thread-1', threadFallback: true },
    'project-1'
  ), true);
  assert.equal(shouldPromoteCurrentDraftToThread(
    { id: 'draft-1', projectId: 'project-1', draft: true },
    { sessionId: 'thread-1', previousSessionId: 'draft-1' },
    'project-2'
  ), false);
});

test('thread.started migrates draft-local composer state onto the accepted session id', () => {
  const moved = [];
  const selectedSessionRef = {
    current: { id: 'draft-project-1-a', projectId: 'project-1', draft: true, title: '正在发送' }
  };

  const result = applySyncSocketPayload({
    type: 'sync-event',
    event: {
      eventType: 'thread.started',
      projectId: 'project-1',
      sessionId: 'thread-2',
      previousSessionId: 'draft-project-1-a',
      draftSessionId: 'draft-project-1-a',
      turnId: 'turn-2',
      timestamp: '2026-05-26T14:31:00.000Z',
      session: { id: 'thread-2', projectId: 'project-1', title: '新线程' }
    }
  }, {
    selectedProjectRef: { current: { id: 'project-1' } },
    selectedSessionRef,
    setSelectedSession() {},
    setSessionsByProject() {},
    upsertSessionInProject(current = {}, _projectId, _session) {
      return current;
    },
    moveComposerDraftState(fromKey, toKey) {
      moved.push([fromKey, toKey]);
    },
    setMessages(update) {
      void update([]);
    }
  });

  assert.equal(result, true);
  assert.deepEqual(moved, [['draft-project-1-a', 'thread-2']]);
});

test('thread.started promotes the current draft to the accepted thread and rewrites visible draft messages', () => {
  const selectedSessionRef = {
    current: { id: 'draft-project-1-a', projectId: 'project-1', draft: true, turnId: 'turn-2', title: '草稿' }
  };
  let nextSelected = selectedSessionRef.current;
  let nextMessages = [
    { id: 'm-1', role: 'user', sessionId: 'draft-project-1-a', turnId: 'turn-2', content: '待发送消息' }
  ];

  const result = applySyncSocketPayload({
    type: 'sync-event',
    event: {
      eventType: 'thread.started',
      projectId: 'project-1',
      sessionId: 'thread-2',
      previousSessionId: 'draft-project-1-a',
      draftSessionId: 'draft-project-1-a',
      turnId: 'turn-2',
      timestamp: '2026-05-26T14:31:00.000Z',
      session: { id: 'thread-2', projectId: 'project-1', title: '新线程' }
    }
  }, {
    selectedProjectRef: { current: { id: 'project-1' } },
    selectedSessionRef,
    setSelectedSession(update) {
      nextSelected = typeof update === 'function' ? update(nextSelected) : update;
    },
    setSessionsByProject() {},
    upsertSessionInProject(current = {}, _projectId, _session) {
      return current;
    },
    setMessages(update) {
      nextMessages = typeof update === 'function' ? update(nextMessages) : update;
    }
  });

  assert.equal(result, true);
  assert.equal(selectedSessionRef.current.id, 'thread-2');
  assert.equal(nextSelected.id, 'thread-2');
  assert.equal(nextMessages[0].sessionId, 'thread-2');
});

test('thread.started promotes the selected session after an active-writer fallback', () => {
  const selectedSessionRef = {
    current: { id: 'thread-old', projectId: 'project-1', draft: false, title: '旧线程' }
  };
  let nextSelected = selectedSessionRef.current;
  let nextMessages = [
    { id: 'm-1', role: 'user', sessionId: 'thread-old', turnId: 'turn-1', content: '恢复测试' }
  ];

  const result = applySyncSocketPayload({
    type: 'sync-event',
    event: {
      eventType: 'thread.started',
      projectId: 'project-1',
      sessionId: 'thread-new',
      previousSessionId: 'thread-old',
      turnId: 'turn-1',
      threadFallback: true,
      timestamp: '2026-08-23T15:17:00.000Z'
    }
  }, {
    selectedProjectRef: { current: { id: 'project-1' } },
    selectedSessionRef,
    setSelectedSession(update) {
      nextSelected = typeof update === 'function' ? update(nextSelected) : update;
    },
    setSessionsByProject() {},
    upsertSessionInProject(current = {}, _projectId, _session) {
      return current;
    },
    setMessages(update) {
      nextMessages = typeof update === 'function' ? update(nextMessages) : update;
    }
  });

  assert.equal(result, true);
  assert.equal(selectedSessionRef.current.id, 'thread-new');
  assert.equal(nextSelected.id, 'thread-new');
  assert.equal(nextMessages[0].sessionId, 'thread-new');
});

test('desktop.sync.status renders a visible status message for the selected session', () => {
  const result = applyWithMessages([], {
    eventType: 'desktop.sync.status',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    status: 'desktop_refresh_failed',
    detail: '桌面端刷新失败，请手动打开该会话'
  });

  assert.equal(result.handled, true);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].role, 'activity');
  assert.equal(result.messages[0].label, '桌面端刷新失败');
  assert.equal(result.messages[0].detail, '桌面端刷新失败，请手动打开该会话');
  assert.equal(result.messages[0].status, 'failed');
});

test('thread.started does not rewrite visible messages for an unrelated selected session', () => {
  const selectedSessionRef = {
    current: { id: 'thread-visible', projectId: 'project-1', draft: false, title: '当前会话' }
  };
  let nextMessages = [
    { id: 'm-1', role: 'user', sessionId: 'thread-visible', turnId: 'turn-visible', content: '当前窗口消息' },
    { id: 'm-2', role: 'assistant', sessionId: 'thread-visible', turnId: 'turn-visible', content: '当前窗口回复' }
  ];

  const result = applySyncSocketPayload({
    type: 'sync-event',
    event: {
      eventType: 'thread.started',
      projectId: 'project-1',
      sessionId: 'thread-background',
      previousSessionId: 'draft-background',
      turnId: 'turn-background',
      timestamp: '2026-05-26T14:32:00.000Z',
      session: { id: 'thread-background', projectId: 'project-1', title: '后台线程' }
    }
  }, {
    selectedProjectRef: { current: { id: 'project-1' } },
    selectedSessionRef,
    setSelectedSession() {},
    setSessionsByProject() {},
    upsertSessionInProject(current = {}, _projectId, _session) {
      return current;
    },
    setMessages(update) {
      nextMessages = typeof update === 'function' ? update(nextMessages) : update;
    }
  });

  assert.equal(result, true);
  assert.deepEqual(nextMessages, [
    { id: 'm-1', role: 'user', sessionId: 'thread-visible', turnId: 'turn-visible', content: '当前窗口消息' },
    { id: 'm-2', role: 'assistant', sessionId: 'thread-visible', turnId: 'turn-visible', content: '当前窗口回复' }
  ]);
});
