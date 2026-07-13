/**
 * 测试 chat/activity-model.js：活动/助手/状态消息的 upsert 与占位判定。
 * Keywords: activity-model, messages, tests
 * Exports: 无导出 / 内含用例
 * Inward: chat/activity-model.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activityStepFromPayload,
  completeActivityMessagesForTurn,
  dismissPlanImplementationPrompts,
  isPlaceholderActivityMessage,
  isVisibleActivityStep,
  removeStalePlanRequestsAfterUserMessages,
  shouldRenderActivityMessageInChat,
  upsertActivityMessage,
  upsertAssistantMessage,
  upsertStatusMessage
} from './chat/activity-model.js';

test('upsertActivityMessage keeps concrete MCP tool calls with generic status labels', () => {
  const result = upsertActivityMessage([], {
    sessionId: 'session-1',
    turnId: 'turn-1',
    messageId: 'tool-1',
    kind: 'mcp_tool_call',
    status: 'completed',
    label: '已完成一步操作',
    detail: 'functions.exec_command',
    toolName: 'exec_command'
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].role, 'activity');
  assert.equal(result[0].activities.length, 1);
  assert.equal(result[0].activities[0].kind, 'mcp_tool_call');
  assert.equal(result[0].activities[0].detail, 'functions.exec_command');
});

test('upsertStatusMessage keeps concrete dynamic tool calls with generic status labels', () => {
  const result = upsertStatusMessage([], {
    sessionId: 'session-1',
    turnId: 'turn-1',
    kind: 'dynamic_tool_call',
    status: 'completed',
    label: '已完成一步操作',
    detail: 'web.run',
    toolName: 'web.run'
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].role, 'activity');
  assert.equal(result[0].activities.length, 1);
  assert.equal(result[0].activities[0].kind, 'dynamic_tool_call');
  assert.equal(result[0].activities[0].detail, 'web.run');
});

test('upsertStatusMessage merges desktop turn updates back into the optimistic mobile card', () => {
  const current = upsertStatusMessage([], {
    sessionId: 'thread-1',
    turnId: 'client-turn-1',
    kind: 'reasoning',
    status: 'running',
    label: '正在思考中',
    timestamp: '2026-05-09T00:00:00.000Z'
  });

  const result = upsertStatusMessage(current, {
    sessionId: 'thread-1',
    turnId: 'desktop-turn-1',
    clientTurnId: 'client-turn-1',
    kind: 'mcp_tool_call',
    status: 'running',
    label: '正在完成一步操作',
    detail: 'functions.exec_command',
    toolName: 'exec_command',
    timestamp: '2026-05-09T00:00:05.000Z'
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'status-client-turn-1');
  assert.equal(result[0].turnId, 'desktop-turn-1');
  assert.equal(result[0].clientTurnId, 'client-turn-1');
  assert.deepEqual(result[0].activities.map((activity) => activity.kind), ['reasoning', 'mcp_tool_call']);
});

test('upsertActivityMessage also merges desktop activity updates by client turn id', () => {
  const current = upsertStatusMessage([], {
    sessionId: 'thread-1',
    turnId: 'client-turn-1',
    kind: 'reasoning',
    status: 'running',
    label: '正在思考中'
  });

  const result = upsertActivityMessage(current, {
    sessionId: 'thread-1',
    turnId: 'desktop-turn-1',
    clientTurnId: 'client-turn-1',
    kind: 'mcp_tool_call',
    status: 'running',
    label: '正在完成一步操作',
    detail: 'functions.exec_command',
    toolName: 'exec_command'
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'status-client-turn-1');
  assert.equal(result[0].turnId, 'desktop-turn-1');
  assert.equal(result[0].clientTurnId, 'client-turn-1');
  assert.deepEqual(result[0].activities.map((activity) => activity.kind), ['reasoning', 'mcp_tool_call']);
});

test('upsertActivityMessage completes standalone context compaction cards', () => {
  const current = upsertActivityMessage([], {
    sessionId: 'thread-1',
    messageId: 'compact-1',
    kind: 'context_compaction',
    status: 'running',
    label: '正在压缩上下文'
  });

  const result = upsertActivityMessage(current, {
    sessionId: 'thread-1',
    messageId: 'compact-1',
    kind: 'context_compaction',
    status: 'completed',
    label: '上下文已压缩',
    timestamp: '2026-05-13T16:00:00.000Z'
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'completed');
  assert.equal(result[0].completedAt, '2026-05-13T16:00:00.000Z');
  assert.equal(result[0].activities.length, 1);
  assert.equal(result[0].activities[0].status, 'completed');
});

test('upsertActivityMessage does not lock turn card completion time from an intermediate tool', () => {
  const current = upsertActivityMessage([], {
    sessionId: 'thread-1',
    turnId: 'turn-1',
    messageId: 'commentary-1',
    kind: 'agent_message',
    phase: 'commentary',
    status: 'running',
    label: '任务开始',
    timestamp: '2026-05-14T03:32:56.000Z'
  });

  const afterTool = upsertActivityMessage(current, {
    sessionId: 'thread-1',
    turnId: 'turn-1',
    messageId: 'cmd-1',
    kind: 'command_execution',
    status: 'completed',
    label: '命令已完成',
    command: 'sleep 1',
    timestamp: '2026-05-14T03:32:58.000Z'
  });

  assert.equal(afterTool.length, 1);
  assert.equal(afterTool[0].status, 'running');
  assert.equal(afterTool[0].completedAt, null);
  assert.equal(afterTool[0].durationMs, null);
});

test('upsertActivityMessage does not complete a turn card when only one child activity completes', () => {
  const current = upsertActivityMessage([], {
    sessionId: 'thread-1',
    turnId: 'turn-1',
    messageId: 'cmd-1',
    kind: 'command_execution',
    status: 'completed',
    label: '命令已完成',
    command: 'npm test',
    timestamp: '2026-05-14T03:32:58.000Z'
  });

  assert.equal(current.length, 1);
  assert.equal(current[0].status, 'running');
  assert.equal(current[0].completedAt, null);
  assert.equal(current[0].activities[0].status, 'completed');
});

test('completeActivityMessagesForTurn marks running activity steps completed', () => {
  const result = completeActivityMessagesForTurn([
    {
      id: 'status-turn-1',
      role: 'activity',
      sessionId: 'session-1',
      turnId: 'turn-1',
      status: 'running',
      activities: [
        { id: 'thinking', kind: 'reasoning', label: '正在思考', status: 'running' },
        { id: 'tool', kind: 'mcp_tool_call', label: '执行操作', status: 'queued' }
      ]
    }
  ], {
    sessionId: 'session-1',
    turnId: 'turn-1',
    completedAt: '2026-05-08T00:00:00.000Z'
  });

  assert.equal(result[0].status, 'completed');
  assert.deepEqual(result[0].activities.map((activity) => activity.status), ['completed', 'completed']);
});

test('completeActivityMessagesForTurn uses full turn timing over stale short activity timing', () => {
  const result = completeActivityMessagesForTurn([
    {
      id: 'status-turn-1',
      role: 'activity',
      status: 'completed',
      sessionId: 'thread-1',
      turnId: 'turn-1',
      timestamp: '2026-05-14T03:32:56.000Z',
      startedAt: '2026-05-14T03:32:56.000Z',
      completedAt: '2026-05-14T03:32:58.000Z',
      durationMs: 2000,
      activities: [
        { id: 'cmd-1', kind: 'command_execution', status: 'completed', label: '命令已完成' }
      ]
    }
  ], {
    sessionId: 'thread-1',
    turnId: 'turn-1',
    completedAt: '2026-05-14T03:34:13.000Z',
    durationMs: 77000
  });

  assert.equal(result[0].completedAt, '2026-05-14T03:34:13.000Z');
  assert.equal(result[0].durationMs, 77000);
});

test('upsertActivityMessage coalesces adjacent loaded and live cards for the same running session', () => {
  const current = [
    {
      id: 'u1',
      role: 'user',
      content: '跑一个任务',
      sessionId: 'thread-1',
      timestamp: '2026-05-14T03:40:00.000Z'
    },
    {
      id: 'activity-loaded',
      role: 'activity',
      status: 'completed',
      sessionId: 'thread-1',
      turnId: 'desktop-turn-1',
      timestamp: '2026-05-14T03:40:01.000Z',
      startedAt: '2026-05-14T03:40:01.000Z',
      completedAt: '2026-05-14T03:40:02.000Z',
      activities: [
        { id: 'commentary-1', kind: 'agent_message', status: 'completed', label: '先查目录。' }
      ]
    }
  ];

  const result = upsertActivityMessage(current, {
    sessionId: 'thread-1',
    turnId: 'headless-turn-1',
    messageId: 'cmd-2',
    kind: 'command_execution',
    status: 'running',
    label: '正在处理本地任务',
    command: 'sleep 45',
    timestamp: '2026-05-14T03:40:20.000Z'
  });

  const activities = result.filter((message) => message.role === 'activity');
  assert.equal(activities.length, 1);
  assert.equal(activities[0].id, 'status-headless-turn-1');
  assert.equal(activities[0].status, 'running');
  assert.equal(activities[0].turnId, 'headless-turn-1');
  assert.deepEqual(
    activities[0].activities.map((activity) => activity.id),
    ['commentary-1', 'cmd-2']
  );
});

test('upsertAssistantMessage preserves the server timestamp instead of re-stamping arrival time', () => {
  const result = upsertAssistantMessage([], {
    messageId: 'assistant-1',
    turnId: 'turn-1',
    sessionId: 'thread-1',
    content: '已完成',
    timestamp: '2026-05-26T13:59:58.000Z'
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].timestamp, '2026-05-26T13:59:58.000Z');
});

test('completeActivityMessagesForTurn keeps pending plan implementation actionable', () => {
  const result = completeActivityMessagesForTurn([
    {
      id: 'status-turn-1',
      role: 'activity',
      sessionId: 'thread-1',
      turnId: 'turn-1',
      status: 'running',
      activities: [
        {
          id: 'implement-plan:app-turn-1',
          kind: 'plan_implementation',
          label: '等待确认执行计划',
          status: 'running',
          planImplementation: {
            requestId: 'implement-plan:app-turn-1',
            turnId: 'app-turn-1',
            planContent: '1. 修复',
            completed: false
          }
        }
      ]
    }
  ], {
    sessionId: 'thread-1',
    turnId: 'turn-1',
    completedAt: '2026-05-08T02:00:05.000Z'
  });

  assert.equal(result[0].status, 'completed');
  assert.equal(result[0].activities[0].status, 'running');
  assert.equal(result[0].activities[0].planImplementation.completed, false);
});

test('running thinking activity renders as a send placeholder', () => {
  const message = {
    id: 'status-turn-1',
    role: 'activity',
    status: 'running',
    activities: [
      { id: 'thinking', kind: 'reasoning', label: '正在思考中', status: 'running' }
    ]
  };

  assert.equal(isPlaceholderActivityMessage(message), false);
  assert.equal(shouldRenderActivityMessageInChat(message), true);
});

test('completed thinking-only activity is suppressed from chat stream', () => {
  assert.equal(isPlaceholderActivityMessage({
    id: 'status-turn-1',
    role: 'activity',
    status: 'completed',
    activities: [
      { id: 'thinking', kind: 'reasoning', label: '正在思考中', status: 'completed' }
    ]
  }), true);
});

test('empty activity container is suppressed from chat stream', () => {
  assert.equal(shouldRenderActivityMessageInChat({
    id: 'activity-turn-1',
    role: 'activity',
    status: 'completed',
    activities: []
  }), false);
});

test('activity steps merge by stable item id while the execution card stays singular', () => {
  const current = upsertActivityMessage([], {
    sessionId: 'thread-1',
    turnId: 'turn-1',
    messageId: 'exec-1',
    kind: 'command_execution',
    status: 'running',
    label: '正在处理本地任务',
    command: 'npm test'
  });

  const result = upsertActivityMessage(current, {
    sessionId: 'thread-1',
    turnId: 'turn-1',
    messageId: 'exec-1',
    kind: 'command_execution',
    status: 'completed',
    label: '本地任务已处理',
    command: 'npm test',
    output: 'ok'
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].activities.length, 1);
  assert.equal(result[0].activities[0].id, 'exec-1');
  assert.equal(result[0].activities[0].status, 'completed');
  assert.equal(result[0].activities[0].output, 'ok');
});

test('upsertStatusMessage appends local thinking placeholder after optimistic user message', () => {
  const result = upsertStatusMessage([
    {
      id: 'local-1',
      role: 'user',
      content: '修一下移动端占位',
      sessionId: 'thread-1',
      turnId: 'turn-1'
    }
  ], {
    source: 'local-optimistic',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    kind: 'reasoning',
    status: 'running',
    label: '正在思考',
    transient: true,
    timestamp: '2026-05-13T12:00:00.000Z'
  });

  assert.equal(result.length, 2);
  assert.equal(result[1].role, 'activity');
  assert.equal(result[1].source, 'local-optimistic');
  assert.equal(result[1].transient, true);
  assert.equal(result[1].activities[0].kind, 'reasoning');
  assert.equal(shouldRenderActivityMessageInChat(result[1]), false);
});

test('real activity update takes over a transient optimistic thinking card', () => {
  const current = upsertStatusMessage([], {
    source: 'local-optimistic',
    sessionId: 'draft-1',
    turnId: 'turn-1',
    kind: 'reasoning',
    status: 'running',
    label: '正在思考',
    transient: true,
    timestamp: '2026-05-13T12:00:00.000Z'
  });

  const result = upsertActivityMessage(current, {
    source: 'headless-local',
    sessionId: 'thread-1',
    previousSessionId: 'draft-1',
    turnId: 'turn-1',
    messageId: 'tool-1',
    kind: 'mcp_tool_call',
    status: 'running',
    label: '正在完成一步操作',
    detail: 'functions.exec_command',
    toolName: 'exec_command',
    timestamp: '2026-05-13T12:00:03.000Z'
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'status-turn-1');
  assert.equal(result[0].transient, false);
  assert.equal(result[0].sessionId, 'thread-1');
  assert.deepEqual(result[0].activities.map((activity) => activity.kind), ['reasoning', 'mcp_tool_call']);
  assert.equal(shouldRenderActivityMessageInChat(result[0]), true);
});

test('activity with concrete work is not treated as placeholder', () => {
  assert.equal(isPlaceholderActivityMessage({
    id: 'status-turn-1',
    role: 'activity',
    status: 'running',
    activities: [
      { id: 'thinking', kind: 'reasoning', label: '正在思考中', status: 'running' },
      { id: 'tool', kind: 'mcp_tool_call', label: '正在执行命令', detail: 'functions.exec_command', status: 'running' }
    ]
  }), false);
});

test('transient local handoff activity is kept for runtime but hidden from chat stream', () => {
  assert.equal(shouldRenderActivityMessageInChat({
    id: 'status-client-turn-1',
    role: 'activity',
    source: 'local-handoff',
    transient: true,
    status: 'running',
    label: '后台启动中',
    activities: [
      { id: 'handoff', kind: 'turn', label: '后台启动中', status: 'running' }
    ]
  }), false);
});

test('real activity still renders in the chat stream', () => {
  assert.equal(shouldRenderActivityMessageInChat({
    id: 'status-turn-1',
    role: 'activity',
    status: 'running',
    activities: [
      { id: 'tool', kind: 'mcp_tool_call', label: '运行命令', detail: 'functions.exec_command', status: 'running' }
    ]
  }), true);
});

test('plan implementation activity is hidden because plan requests render as standalone cards', () => {
  const step = activityStepFromPayload({
    sessionId: 'thread-1',
    turnId: 'turn-1',
    messageId: 'implement-plan:turn-1',
    kind: 'plan_implementation',
    status: 'running',
    label: '等待确认执行计划',
    detail: '1. 定位同步链路',
    planImplementation: {
      requestId: 'implement-plan:turn-1',
      turnId: 'turn-1',
      planContent: '1. 定位同步链路',
      completed: false
    }
  });

  assert.equal(isVisibleActivityStep(step, 'completed'), false);
  assert.deepEqual(step.planImplementation, {
    requestId: 'implement-plan:turn-1',
    turnId: 'turn-1',
    planContent: '1. 定位同步链路',
    completed: false
  });
});

test('upsertAssistantMessage renders proposed plans as standalone plan messages', () => {
  const result = upsertAssistantMessage([], {
    sessionId: 'thread-1',
    turnId: 'turn-1',
    messageId: 'assistant-plan-1',
    content: '<proposed_plan>\n# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。\n</proposed_plan>'
  });

  assert.deepEqual(result.map((message) => message.role), ['plan', 'plan_request']);
  assert.equal(result[0].id, 'assistant-plan-1-plan');
  assert.equal(result[0].title, '移动端计划模式测试计划');
  assert.equal(result[0].content, '# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。');
  assert.deepEqual(result[1].planImplementation, {
    requestId: 'implement-plan:turn-1',
    turnId: 'turn-1',
    planContent: '# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。',
    completed: false
  });
});

test('upsertActivityMessage promotes streamed proposed plans out of the activity card', () => {
  const result = upsertActivityMessage([
    {
      id: 'status-turn-1',
      role: 'activity',
      sessionId: 'thread-1',
      turnId: 'turn-1',
      status: 'running',
      activities: [{ id: 'browser-1', kind: 'browser', label: '已操作浏览器', status: 'completed' }]
    }
  ], {
    sessionId: 'thread-1',
    turnId: 'turn-1',
    messageId: 'assistant-plan-1',
    kind: 'agent_message',
    status: 'completed',
    label: '<proposed_plan>\n# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。\n</proposed_plan>'
  });

  assert.deepEqual(result.map((message) => message.role), ['plan', 'plan_request']);
  assert.equal(result[0].content, '# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。');
  assert.equal(result[1].planImplementation.requestId, 'implement-plan:turn-1');
});

test('upsertActivityMessage promotes proposed plans from tool output out of the activity card', () => {
  const result = upsertActivityMessage([
    {
      id: 'status-turn-1',
      role: 'activity',
      sessionId: 'thread-1',
      turnId: 'turn-1',
      status: 'running',
      activities: [{ id: 'browser-1', kind: 'dynamic_tool_call', label: '操作浏览器', status: 'completed' }]
    }
  ], {
    sessionId: 'thread-1',
    turnId: 'turn-1',
    messageId: 'browser-1',
    kind: 'dynamic_tool_call',
    status: 'completed',
    label: '已操作浏览器',
    output: '<proposed_plan>\n# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。\n</proposed_plan>'
  });

  assert.deepEqual(result.map((message) => message.role), ['plan', 'plan_request']);
  assert.equal(result[0].content, '# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。');
  assert.equal(result[1].planImplementation.planContent, '# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。');
});

test('upsertActivityMessage promotes plan implementation requests out of the activity card', () => {
  const result = upsertActivityMessage([
    {
      id: 'status-turn-1',
      role: 'activity',
      sessionId: 'thread-1',
      turnId: 'turn-1',
      status: 'running',
      activities: [{ id: 'thinking', kind: 'reasoning', label: '正在思考', status: 'running' }]
    }
  ], {
    sessionId: 'thread-1',
    turnId: 'turn-1',
    messageId: 'implement-plan:app-turn-1',
    kind: 'plan_implementation',
    status: 'running',
    label: '等待确认执行计划',
    detail: '# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。',
    planImplementation: {
      requestId: 'implement-plan:app-turn-1',
      turnId: 'app-turn-1',
      planContent: '# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。',
      completed: false
    }
  });

  assert.deepEqual(result.map((message) => message.role), ['plan', 'plan_request']);
  assert.equal(result[0].id, 'implement-plan:app-turn-1-plan');
  assert.deepEqual(result[1].planImplementation, {
    requestId: 'implement-plan:app-turn-1',
    turnId: 'app-turn-1',
    planContent: '# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。',
    completed: false
  });
});

test('dismissPlanImplementationPrompts removes the plan request after a choice is submitted', () => {
  const result = dismissPlanImplementationPrompts([
    {
      id: 'plan-1',
      role: 'plan',
      content: '1. 定位同步链路'
    },
    {
      id: 'request-1',
      role: 'plan_request',
      content: '实施此计划?',
      planImplementation: {
        requestId: 'implement-plan:turn-1',
        turnId: 'turn-1',
        planContent: '1. 定位同步链路',
        completed: false
      }
    },
    {
      id: 'activity-1',
      role: 'activity',
      status: 'completed',
      activities: [
        {
          id: 'step-1',
          kind: 'plan_implementation',
          status: 'completed',
          label: '等待确认执行计划',
          planImplementation: {
            requestId: 'implement-plan:turn-1',
            turnId: 'turn-1',
            planContent: '1. 定位同步链路',
            completed: false
          }
        }
      ]
    }
  ], {
    requestId: 'implement-plan:turn-1',
    turnId: 'turn-1',
    planContent: '1. 定位同步链路'
  });

  assert.deepEqual(result.map((message) => message.role), ['plan', 'activity']);
  assert.equal(result[1].activities[0].planImplementation.completed, true);
  assert.equal(isVisibleActivityStep(result[1].activities[0], result[1].status), false);
  assert.equal(shouldRenderActivityMessageInChat(result[1]), false);
});

test('removeStalePlanRequestsAfterUserMessages hides expired plan confirmations', () => {
  const result = removeStalePlanRequestsAfterUserMessages([
    { id: 'plan-1', role: 'plan', content: '1. 定位同步链路' },
    {
      id: 'request-1',
      role: 'plan_request',
      content: '实施此计划?',
      planImplementation: { requestId: 'implement-plan:turn-1', planContent: '1. 定位同步链路' }
    },
    { id: 'user-2', role: 'user', content: '修改这个问题' },
    { id: 'plan-2', role: 'plan', content: '2. 新计划' },
    {
      id: 'request-2',
      role: 'plan_request',
      content: '实施此计划?',
      planImplementation: { requestId: 'implement-plan:turn-2', planContent: '2. 新计划' }
    }
  ]);

  assert.deepEqual(result.map((message) => message.id), ['plan-1', 'user-2', 'plan-2', 'request-2']);
});
