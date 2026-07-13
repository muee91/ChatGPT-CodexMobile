/**
 * 测试桌面活动与 thread 投影：messagesFromDesktopThread、raw activities 合并。
 *
 * Keywords: codex-data, desktop-activity, test, thread
 *
 * Exports: 无导出，内含用例
 *
 * Inward: codex-data.js, desktop-thread-projector.js, desktop-activity-parser.js
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { messagesFromDesktopThread, rawSessionActivitiesFromJsonl } from './codex-data.js';
import {
  removeDuplicateGuidedUserSegments,
  removeFallbackActivitiesCoveredByRaw,
  upsertDesktopActivity
} from './desktop-thread-projector.js';

test('messagesFromDesktopThread preserves running desktop file activity', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'running',
        startedAt: 1770000000,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '修一下 UI' }] },
          {
            id: 'file-1',
            type: 'fileChange',
            status: 'running',
            changes: [{ path: '/tmp/App.jsx', kind: 'update', unified_diff: '+ok\n' }]
          }
        ]
      }
    ]
  }, { includeActivity: true });

  const activityMessage = messages.find((message) => message.role === 'activity');
  assert.equal(activityMessage.status, 'running');
  assert.equal(activityMessage.activities[0].kind, 'file_change');
  assert.equal(activityMessage.activities[0].status, 'running');
  assert.equal(activityMessage.activities[0].label, '正在更新文件');
});

test('messagesFromDesktopThread keeps the activity container running between completed desktop steps', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'running',
        startedAt: Date.parse('2026-05-14T02:00:00.000Z') / 1000,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '继续排查' }] },
          {
            id: 'cmd-1',
            type: 'commandExecution',
            status: 'completed',
            command: 'rg activity',
            aggregatedOutput: 'ok',
            startedAt: '2026-05-14T02:00:03.000Z',
            completedAt: '2026-05-14T02:00:14.000Z'
          }
        ]
      }
    ]
  }, { includeActivity: true });

  const activityMessage = messages.find((message) => message.role === 'activity');
  assert.equal(activityMessage.status, 'running');
  assert.equal(activityMessage.completedAt, null);
  assert.equal(activityMessage.durationMs, null);
  assert.equal(activityMessage.activities[0].status, 'completed');
});

test('messagesFromDesktopThread uses mobile labels for completed desktop command activity', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'completed',
        startedAt: 1770000000,
        completedAt: 1770000003,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '跑测试' }] },
          {
            id: 'cmd-1',
            type: 'commandExecution',
            status: 'completed',
            command: 'npm test',
            aggregatedOutput: 'ok'
          },
          { id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: '测试通过' }
        ]
      }
    ]
  }, { includeActivity: true });

  const activityMessage = messages.find((message) => message.role === 'activity');
  assert.equal(activityMessage.status, 'completed');
  assert.equal(activityMessage.activities[0].kind, 'command_execution');
  assert.equal(activityMessage.activities[0].status, 'completed');
  assert.equal(activityMessage.activities[0].label, '本地任务已处理');
});

test('messagesFromDesktopThread keeps desktop turn duration as activity summary time', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'completed',
        startedAt: Date.parse('2026-02-02T00:00:00.000Z') / 1000,
        completedAt: Date.parse('2026-02-02T00:00:10.000Z') / 1000,
        durationMs: 114000,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '同步一下处理时间' }] },
          {
            id: 'cmd-1',
            type: 'commandExecution',
            status: 'completed',
            command: 'npm test',
            aggregatedOutput: 'ok'
          },
          { id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: '好了' }
        ]
      }
    ]
  }, { includeActivity: true });

  const activityMessage = messages.find((message) => message.role === 'activity');
  assert.equal(activityMessage.durationMs, 114000);
  assert.equal(activityMessage.startedAt, '2026-02-02T00:00:00.000Z');
  assert.equal(activityMessage.completedAt, '2026-02-02T00:00:10.000Z');
});

test('messagesFromDesktopThread derives activity duration from item timing when turn has none', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'completed',
        startedAt: Date.parse('2026-02-02T00:00:00.000Z') / 1000,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '跑一下命令' }] },
          {
            id: 'cmd-1',
            type: 'commandExecution',
            status: 'completed',
            startedAt: '2026-02-02T00:00:03.000Z',
            completedAt: '2026-02-02T00:00:12.000Z',
            command: 'npm test',
            aggregatedOutput: 'ok'
          },
          { id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: '好了' }
        ]
      }
    ]
  }, { includeActivity: true });

  const activityMessage = messages.find((message) => message.role === 'activity');
  assert.equal(activityMessage.startedAt, '2026-02-02T00:00:03.000Z');
  assert.equal(activityMessage.completedAt, '2026-02-02T00:00:12.000Z');
  assert.equal(activityMessage.durationMs, 9000);
});

test('messagesFromDesktopThread marks steered user messages inside the same turn', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'running',
        startedAt: Date.parse('2026-02-02T00:00:00.000Z') / 1000,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '先修列表同步' }] },
          {
            id: 'commentary-1',
            type: 'agentMessage',
            phase: 'commentary',
            text: '先看状态。'
          },
          { id: 'user-2', type: 'userMessage', content: [{ type: 'text', text: '再把移动端 UI 分开' }] },
          {
            id: 'cmd-1',
            type: 'commandExecution',
            status: 'running',
            command: 'rg steer client/src'
          }
        ]
      }
    ]
  }, { includeActivity: true });

  const userMessages = messages.filter((message) => message.role === 'user');
  assert.deepEqual(
    userMessages.map((message) => [message.content, Boolean(message.guided), message.guideLabel || '']),
    [
      ['先修列表同步', false, ''],
      ['再把移动端 UI 分开', true, '已引导对话']
    ]
  );

  const guidedActivity = messages.find((message) => message.role === 'activity' && message.segmentIndex === 1);
  assert.equal(guidedActivity?.activities[0].kind, 'command_execution');
  assert.equal(guidedActivity.activities[0].command, 'rg steer client/src');
});

test('raw desktop activities are inserted next to their matching steered user segment', () => {
  const messages = [
    {
      id: 'user-1',
      role: 'user',
      content: '先修列表同步',
      turnId: 'turn-1',
      timestamp: '2026-02-02T00:00:00.100Z'
    },
    {
      id: 'answer-1',
      role: 'assistant',
      content: '第一段回复',
      turnId: 'turn-1',
      timestamp: '2026-02-02T00:00:01.500Z'
    },
    {
      id: 'user-2',
      role: 'user',
      content: '再把移动端 UI 分开',
      turnId: 'turn-1',
      guided: true,
      timestamp: '2026-02-02T00:00:02.000Z'
    },
    {
      id: 'answer-2',
      role: 'assistant',
      content: '第二段回复',
      turnId: 'turn-1',
      timestamp: '2026-02-02T00:00:04.000Z'
    }
  ];

  upsertDesktopActivity(messages, 'turn-1', {
    id: 'turn-1-raw-command-1',
    kind: 'command_execution',
    label: '本地任务已处理',
    command: 'rg steer client/src',
    status: 'completed',
    timestamp: '2026-02-02T00:00:03.000Z'
  }, 1);
  upsertDesktopActivity(messages, 'turn-1', {
    id: 'turn-1-raw-command-0',
    kind: 'command_execution',
    label: '本地任务已处理',
    command: 'git status --short',
    status: 'completed',
    timestamp: '2026-02-02T00:00:01.000Z'
  }, 0);

  assert.deepEqual(
    messages.map((message) => message.id),
    ['user-1', 'activity-turn-1', 'answer-1', 'user-2', 'activity-turn-1-1', 'answer-2']
  );
  assert.equal(messages[1].activities[0].command, 'git status --short');
  assert.equal(messages[4].activities[0].command, 'rg steer client/src');
});

test('completed raw desktop activities create terminal activity containers', () => {
  const messages = [
    {
      id: 'user-1',
      role: 'user',
      content: '查一下状态',
      turnId: 'turn-1',
      timestamp: '2026-02-02T00:00:00.000Z'
    },
    {
      id: 'answer-1',
      role: 'assistant',
      content: '已经好了',
      turnId: 'turn-1',
      timestamp: '2026-02-02T00:00:04.000Z'
    }
  ];

  upsertDesktopActivity(messages, 'turn-1', {
    id: 'turn-1-raw-command-0',
    kind: 'command_execution',
    label: '本地任务已处理',
    command: 'git status --short',
    status: 'completed',
    timestamp: '2026-02-02T00:00:01.000Z'
  });
  upsertDesktopActivity(messages, 'turn-1', {
    id: 'turn-1-raw-command-1',
    kind: 'command_execution',
    label: '本地任务已处理',
    command: 'npm run build',
    status: 'completed',
    timestamp: '2026-02-02T00:00:04.000Z'
  });

  const activity = messages.find((message) => message.role === 'activity');
  assert.equal(activity.status, 'completed');
  assert.equal(activity.label, '过程已同步');
  assert.equal(activity.startedAt, '2026-02-02T00:00:01.000Z');
  assert.equal(activity.completedAt, '2026-02-02T00:00:04.000Z');
  assert.equal(activity.durationMs, 3000);
});

test('removeFallbackActivitiesCoveredByRaw removes empty fallback containers', () => {
  const messages = [
    {
      id: 'activity-turn-1',
      role: 'activity',
      turnId: 'turn-1',
      status: 'running',
      activities: [
        {
          id: 'fallback-command',
          kind: 'command_execution',
          label: '正在处理本地任务',
          status: 'running'
        }
      ]
    }
  ];

  removeFallbackActivitiesCoveredByRaw(messages, [
    {
      turnId: 'turn-1',
      activity: {
        id: 'turn-1-raw-command-0',
        kind: 'command_execution',
        status: 'completed'
      }
    }
  ]);

  assert.deepEqual(messages, []);
});

test('upsertDesktopActivity lets desktop completion replace running timing', () => {
  const messages = [
    {
      id: 'user-1',
      role: 'user',
      content: '跑一下测试',
      turnId: 'turn-1',
      timestamp: '2026-02-02T00:00:00.000Z'
    }
  ];

  upsertDesktopActivity(messages, 'turn-1', {
    id: 'turn-1-command-0',
    kind: 'command_execution',
    label: '正在处理本地任务',
    command: 'npm test',
    status: 'running',
    startedAt: '2026-02-02T00:00:01.000Z',
    timestamp: '2026-02-02T00:00:01.000Z'
  });
  upsertDesktopActivity(messages, 'turn-1', {
    id: 'turn-1-command-0',
    kind: 'command_execution',
    label: '本地任务已处理',
    command: 'npm test',
    status: 'completed',
    startedAt: '2026-02-02T00:00:01.000Z',
    completedAt: '2026-02-02T00:00:08.000Z',
    durationMs: 7000,
    timestamp: '2026-02-02T00:00:08.000Z'
  });

  const activity = messages.find((message) => message.role === 'activity');
  assert.equal(activity.status, 'completed');
  assert.equal(activity.activities[0].label, '本地任务已处理');
  assert.equal(activity.completedAt, '2026-02-02T00:00:08.000Z');
  assert.equal(activity.durationMs, 7000);
});

test('messagesFromDesktopThread renders desktop plans and implementation requests as standalone messages', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'completed',
        startedAt: 1770000000,
        completedAt: 1770000003,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '/plan 修复同步问题' }] },
          { id: 'plan-1', type: 'plan', status: 'completed', text: '1. 定位同步链路\n2. 补测试\n3. 修复' },
          {
            id: 'implement-plan:turn-1',
            type: 'planImplementation',
            turnId: 'turn-1',
            planContent: '1. 定位同步链路\n2. 补测试\n3. 修复',
            isCompleted: false
          }
        ]
      }
    ]
  }, { includeActivity: true });

  assert.deepEqual(messages.map((message) => message.role), ['user', 'plan', 'plan_request']);
  const planMessage = messages.find((message) => message.role === 'plan');
  assert.equal(planMessage.content, '1. 定位同步链路\n2. 补测试\n3. 修复');
  assert.equal(planMessage.title, '计划');
  const requestMessage = messages.find((message) => message.role === 'plan_request');
  assert.equal(requestMessage.content, '实施此计划?');
  assert.equal(requestMessage.status, 'running');
  assert.deepEqual(requestMessage.planImplementation, {
    requestId: 'implement-plan:turn-1',
    turnId: 'turn-1',
    planContent: '1. 定位同步链路\n2. 补测试\n3. 修复',
    completed: false
  });
  assert.equal(messages.some((message) => message.role === 'activity'), false);
});

test('messagesFromDesktopThread synthesizes a plan request when desktop exposes only the plan item', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'completed',
        startedAt: 1770000000,
        completedAt: 1770000003,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '/plan 修复同步问题' }] },
          { id: 'plan-1', type: 'plan', status: 'completed', text: '# 修复计划\n\n## Summary\n处理移动端计划 UI。' }
        ]
      }
    ]
  }, { includeActivity: true });

  assert.deepEqual(messages.map((message) => message.role), ['user', 'plan', 'plan_request']);
  assert.equal(messages[2].planImplementation.requestId, 'implement-plan:turn-1');
  assert.equal(messages[2].planImplementation.planContent, '# 修复计划\n\n## Summary\n处理移动端计划 UI。');
});

test('messagesFromDesktopThread converts proposed plan final answers into plan UI messages', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'completed',
        startedAt: 1770000000,
        completedAt: 1770000003,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '/plan 修复同步问题' }] },
          {
            id: 'answer-1',
            type: 'agentMessage',
            phase: 'final_answer',
            text: '<proposed_plan>\n# 修复计划\n\n## Summary\n处理移动端计划 UI。\n</proposed_plan>'
          }
        ]
      }
    ]
  }, { includeActivity: true });

  assert.deepEqual(messages.map((message) => message.role), ['user', 'plan', 'plan_request']);
  assert.equal(messages[1].title, '修复计划');
  assert.equal(messages[1].content, '# 修复计划\n\n## Summary\n处理移动端计划 UI。');
  assert.equal(messages[2].planImplementation.planContent, '# 修复计划\n\n## Summary\n处理移动端计划 UI。');
});

test('messagesFromDesktopThread renders internal implement-plan followups as a short user action', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-2',
        status: 'running',
        startedAt: 1770000005,
        items: [
          {
            id: 'user-2',
            type: 'userMessage',
            content: [{ type: 'text', text: 'PLEASE IMPLEMENT THIS PLAN:\n1. 定位同步链路\n2. 补测试' }]
          }
        ]
      }
    ]
  });

  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, '执行计划');
});

test('messagesFromDesktopThread hides desktop injected browser context from user bubbles', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'completed',
        startedAt: 1770000000,
        completedAt: 1770000003,
        items: [
          {
            id: 'user-1',
            type: 'userMessage',
            content: [{
              type: 'text',
              text: [
                '# In app browser:',
                '- The user has the in-app browser open.',
                '- Current URL: http://localhost:3321/',
                '',
                '## My request for Codex:',
                '移动端点线程重命名，没弹窗 没反应啊'
              ].join('\n')
            }]
          },
          { id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: '修好了' }
        ]
      }
    ]
  });

  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, '移动端点线程重命名，没弹窗 没反应啊');
});

test('messagesFromDesktopThread drops duplicate guided browser request envelopes', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'completed',
        startedAt: 1770000000,
        completedAt: 1770000003,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: 'ok 现在是移动端随便发一条消息测试' }] },
          {
            id: 'browser-envelope-1',
            type: 'userMessage',
            content: [{
              type: 'text',
              text: [
                '# In app browser:',
                '- The user has the in-app browser open.',
                '- Current URL: http://localhost:3321/',
                '',
                '## My request for Codex:',
                'ok 现在是移动端随便发一条消息测试'
              ].join('\n')
            }]
          },
          { id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: 'OK' }
        ]
      }
    ]
  }, { includeActivity: true });

  const userMessages = messages.filter((message) => message.role === 'user');
  assert.deepEqual(userMessages.map((message) => [message.content, Boolean(message.guided)]), [
    ['ok 现在是移动端随便发一条消息测试', false]
  ]);
  assert.equal(messages.some((message) => message.role === 'activity' && message.segmentIndex === 1), false);
});

test('removeDuplicateGuidedUserSegments drops orphan activity for removed duplicate segment', () => {
  const messages = removeDuplicateGuidedUserSegments([
    { id: 'user-1', role: 'user', content: '同一条消息', turnId: 'turn-1', segmentIndex: 0 },
    { id: 'user-2', role: 'user', content: '同一条消息', turnId: 'turn-1', segmentIndex: 1, guided: true },
    { id: 'activity-1', role: 'activity', content: '过程已同步', turnId: 'turn-1', segmentIndex: 1, status: 'completed' },
    { id: 'user-3', role: 'user', content: '真正的新引导', turnId: 'turn-1', segmentIndex: 2, guided: true },
    { id: 'activity-2', role: 'activity', content: '过程已同步', turnId: 'turn-1', segmentIndex: 2, status: 'completed' }
  ]);

  assert.deepEqual(messages.map((message) => message.id), ['user-1', 'user-3', 'activity-2']);
});

test('messagesFromDesktopThread removes stale plan request after implementation starts', () => {
  const planContent = '# 修复计划\n\n## Summary\n处理移动端计划 UI。';
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'completed',
        startedAt: 1770000000,
        completedAt: 1770000003,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '/plan 修复同步问题' }] },
          {
            id: 'answer-1',
            type: 'agentMessage',
            phase: 'final_answer',
            text: `<proposed_plan>\n${planContent}\n</proposed_plan>`
          }
        ]
      },
      {
        id: 'turn-2',
        status: 'running',
        startedAt: 1770000005,
        items: [
          {
            id: 'user-2',
            type: 'userMessage',
            content: [{ type: 'text', text: `PLEASE IMPLEMENT THIS PLAN:\n${planContent}` }]
          }
        ]
      }
    ]
  }, { includeActivity: true });

  assert.deepEqual(messages.map((message) => message.role), ['user', 'plan', 'user']);
  assert.equal(messages[1].content, planContent);
  assert.equal(messages[2].content, '执行计划');
});

test('messagesFromDesktopThread removes stale plan request after minimal implementation prompt', () => {
  const planContent = '# 修复计划\n\n## Summary\n处理移动端计划 UI。';
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'completed',
        startedAt: 1770000000,
        completedAt: 1770000003,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '/plan 修复同步问题' }] },
          {
            id: 'answer-1',
            type: 'agentMessage',
            phase: 'final_answer',
            text: `<proposed_plan>\n${planContent}\n</proposed_plan>`
          }
        ]
      },
      {
        id: 'turn-2',
        status: 'running',
        startedAt: 1770000005,
        items: [
          {
            id: 'user-2',
            type: 'userMessage',
            content: [{ type: 'text', text: 'Implement plan.' }]
          }
        ]
      }
    ]
  }, { includeActivity: true });

  assert.deepEqual(messages.map((message) => message.role), ['user', 'plan', 'user']);
  assert.equal(messages[1].content, planContent);
  assert.equal(messages[2].content, '执行计划');
});

test('messagesFromDesktopThread keeps future plan requests after an earlier minimal implementation prompt', () => {
  const firstPlan = '# 第一份计划\n\n## Summary\n旧计划。';
  const secondPlan = '# 第二份计划\n\n## Summary\n新计划。';
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'completed',
        startedAt: 1770000000,
        completedAt: 1770000003,
        items: [
          {
            id: 'answer-1',
            type: 'agentMessage',
            phase: 'final_answer',
            text: `<proposed_plan>\n${firstPlan}\n</proposed_plan>`
          }
        ]
      },
      {
        id: 'turn-2',
        status: 'completed',
        startedAt: 1770000005,
        completedAt: 1770000006,
        items: [
          { id: 'user-2', type: 'userMessage', content: [{ type: 'text', text: 'Implement plan.' }] }
        ]
      },
      {
        id: 'turn-3',
        status: 'completed',
        startedAt: 1770000010,
        completedAt: 1770000012,
        items: [
          {
            id: 'answer-3',
            type: 'agentMessage',
            phase: 'final_answer',
            text: `<proposed_plan>\n${secondPlan}\n</proposed_plan>`
          }
        ]
      }
    ]
  }, { includeActivity: true });

  assert.deepEqual(messages.map((message) => message.role), ['plan', 'user', 'plan', 'plan_request']);
  assert.equal(messages[2].content, secondPlan);
  assert.equal(messages[3].planImplementation.planContent, secondPlan);
});

test('messagesFromDesktopThread hides stale plan request after a later user message', () => {
  const planContent = '# 修复计划\n\n## Summary\n处理移动端计划 UI。';
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'completed',
        startedAt: 1770000000,
        completedAt: 1770000003,
        items: [
          {
            id: 'answer-1',
            type: 'agentMessage',
            phase: 'final_answer',
            text: `<proposed_plan>\n${planContent}\n</proposed_plan>`
          }
        ]
      },
      {
        id: 'turn-2',
        status: 'completed',
        startedAt: 1770000005,
        completedAt: 1770000006,
        items: [
          { id: 'user-2', type: 'userMessage', content: [{ type: 'text', text: '修改这个问题' }] }
        ]
      }
    ]
  }, { includeActivity: true });

  assert.deepEqual(messages.map((message) => message.role), ['plan', 'user']);
});

test('rawSessionActivitiesFromJsonl restores exec_command events omitted by desktop thread read', () => {
  const content = [
    {
      timestamp: '2026-02-02T00:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call-1',
        arguments: JSON.stringify({ cmd: 'rg foo client/src' })
      }
    },
    {
      timestamp: '2026-02-02T00:00:01.500Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'Chunk ID: abc\nWall time: 0.0000 seconds\nProcess exited with code 0\nOutput:\nclient/src/App.jsx:foo'
      }
    }
  ].map((entry) => JSON.stringify(entry)).join('\n');

  const activities = rawSessionActivitiesFromJsonl(content, [
    {
      id: 'turn-1',
      startedAt: Date.parse('2026-02-02T00:00:00.000Z') / 1000,
      completedAt: Date.parse('2026-02-02T00:00:03.000Z') / 1000
    }
  ]);

  assert.equal(activities.length, 1);
  assert.equal(activities[0].turnId, 'turn-1');
  assert.equal(activities[0].activity.kind, 'command_execution');
  assert.equal(activities[0].activity.status, 'completed');
  assert.equal(activities[0].activity.command, 'rg foo client/src');
  assert.equal(activities[0].activity.output, 'client/src/App.jsx:foo');
  assert.equal(activities[0].activity.startedAt, '2026-02-02T00:00:01.000Z');
  assert.equal(activities[0].activity.completedAt, '2026-02-02T00:00:01.500Z');
  assert.equal(activities[0].activity.durationMs, 500);
});

test('rawSessionActivitiesFromJsonl extracts file changes from apply_patch calls', () => {
  const content = [
    {
      timestamp: '2026-02-02T00:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'apply_patch',
        call_id: 'patch-1',
        input: [
          '*** Begin Patch',
          '*** Update File: client/src/chat/ActivityMessage.jsx',
          '@@',
          '-  const hasProcess = timeline.length > 0 || Boolean(fileSummary);',
          '+  const hasProcess = timeline.length > 0;',
          '+  const showFileSummary = Boolean(fileSummary) && !running;',
          '*** End Patch'
        ].join('\n')
      }
    },
    {
      timestamp: '2026-02-02T00:00:01.500Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'patch-1',
        output: 'Exit code: 0\nOutput:\nSuccess. Updated the following files:\nM client/src/chat/ActivityMessage.jsx'
      }
    }
  ].map((entry) => JSON.stringify(entry)).join('\n');

  const activities = rawSessionActivitiesFromJsonl(content, [
    {
      id: 'turn-1',
      startedAt: Date.parse('2026-02-02T00:00:00.000Z') / 1000,
      completedAt: Date.parse('2026-02-02T00:00:03.000Z') / 1000
    }
  ]);

  assert.equal(activities.length, 1);
  assert.equal(activities[0].activity.kind, 'file_change');
  assert.deepEqual(activities[0].activity.fileChanges.map((change) => ({
    path: change.path,
    additions: change.additions,
    deletions: change.deletions
  })), [
    {
      path: 'client/src/chat/ActivityMessage.jsx',
      additions: 2,
      deletions: 1
    }
  ]);
  assert.match(activities[0].activity.fileChanges[0].unifiedDiff, /\+  const showFileSummary/);
});

test('rawSessionActivitiesFromJsonl treats missing output in interrupted turns as terminal', () => {
  const content = JSON.stringify({
    timestamp: '2026-02-02T00:00:01.000Z',
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'write_stdin',
      call_id: 'call-unfinished',
      arguments: JSON.stringify({ session_id: 123 })
    }
  });

  const activities = rawSessionActivitiesFromJsonl(content, [
    {
      id: 'turn-1',
      status: 'interrupted',
      startedAt: Date.parse('2026-02-02T00:00:00.000Z') / 1000
    }
  ]);

  assert.equal(activities.length, 1);
  assert.equal(activities[0].activity.status, 'failed');
  assert.equal(activities[0].activity.label, '本地任务失败');
});

test('rawSessionActivitiesFromJsonl expands parallel exec_command calls', () => {
  const content = JSON.stringify({
    timestamp: '2026-02-02T00:00:01.000Z',
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'parallel',
      call_id: 'call-parallel',
      arguments: JSON.stringify({
        tool_uses: [
          {
            recipient_name: 'functions.exec_command',
            parameters: { cmd: 'git status --short' }
          },
          {
            recipient_name: 'functions.exec_command',
            parameters: { cmd: 'npm run build' }
          }
        ]
      })
    }
  });

  const activities = rawSessionActivitiesFromJsonl(content, [
    {
      id: 'turn-1',
      startedAt: Date.parse('2026-02-02T00:00:00.000Z') / 1000,
      completedAt: Date.parse('2026-02-02T00:00:03.000Z') / 1000
    }
  ]);

  assert.deepEqual(
    activities.map((item) => item.activity.command),
    ['git status --short', 'npm run build']
  );
});

test('rawSessionActivitiesFromJsonl preserves commentary and tool order', () => {
  const turnWindow = [
    {
      id: 'turn-1',
      startedAt: Date.parse('2026-02-02T00:00:00.000Z') / 1000,
      completedAt: Date.parse('2026-02-02T00:00:10.000Z') / 1000
    }
  ];
  const content = [
    {
      timestamp: '2026-02-02T00:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        content: [{ type: 'output_text', text: '先看状态。' }]
      }
    },
    {
      timestamp: '2026-02-02T00:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call-1',
        arguments: JSON.stringify({ cmd: 'git status --short' })
      }
    },
    {
      timestamp: '2026-02-02T00:00:02.500Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'Process exited with code 0\nOutput:\n M file.js'
      }
    },
    {
      timestamp: '2026-02-02T00:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        content: [{ type: 'output_text', text: '再看页面。' }]
      }
    },
    {
      timestamp: '2026-02-02T00:00:04.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        namespace: 'mcp__playwright__',
        name: 'browser_snapshot',
        call_id: 'call-2',
        arguments: '{}'
      }
    },
    {
      timestamp: '2026-02-02T00:00:04.500Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-2',
        output: 'OK'
      }
    },
    {
      timestamp: '2026-02-02T00:00:05.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: '完成。' }]
      }
    }
  ].map((entry) => JSON.stringify(entry)).join('\n');

  const activities = rawSessionActivitiesFromJsonl(content, turnWindow);

  assert.deepEqual(
    activities.map((item) => item.activity.kind),
    ['agent_message', 'command_execution', 'agent_message', 'mcp_tool_call']
  );
  assert.deepEqual(
    activities.map((item) => item.activity.label),
    ['先看状态。', '本地任务已处理', '再看页面。', '已完成一步操作']
  );
});

test('rawSessionActivitiesFromJsonl assigns activity after steered user input to the guided segment', () => {
  const turnWindow = [
    {
      id: 'turn-1',
      startedAt: Date.parse('2026-02-02T00:00:00.000Z') / 1000,
      completedAt: Date.parse('2026-02-02T00:00:10.000Z') / 1000
    }
  ];
  const content = [
    {
      timestamp: '2026-02-02T00:00:00.100Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '先修列表同步' }]
      }
    },
    {
      timestamp: '2026-02-02T00:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        content: [{ type: 'output_text', text: '先看状态。' }]
      }
    },
    {
      timestamp: '2026-02-02T00:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '再把移动端 UI 分开' }]
      }
    },
    {
      timestamp: '2026-02-02T00:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call-1',
        arguments: JSON.stringify({ cmd: 'rg steer client/src' })
      }
    },
    {
      timestamp: '2026-02-02T00:00:03.500Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'Process exited with code 0\nOutput:\nclient/src/App.jsx:steer'
      }
    }
  ].map((entry) => JSON.stringify(entry)).join('\n');

  const activities = rawSessionActivitiesFromJsonl(content, turnWindow);

  assert.deepEqual(
    activities.map((item) => [item.activity.kind, item.segmentIndex ?? 0]),
    [
      ['agent_message', 0],
      ['command_execution', 1]
    ]
  );
});

test('rawSessionActivitiesFromJsonl ignores hidden environment user rows when assigning guided segments', () => {
  const turnWindow = [
    {
      id: 'turn-1',
      startedAt: Date.parse('2026-02-02T00:00:00.000Z') / 1000,
      completedAt: Date.parse('2026-02-02T00:00:10.000Z') / 1000
    }
  ];
  const content = [
    {
      timestamp: '2026-02-02T00:00:00.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '<environment_context>\\n  <cwd>/tmp/project</cwd>\\n</environment_context>' }]
      }
    },
    {
      timestamp: '2026-02-02T00:00:00.010Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-1' }
    },
    {
      timestamp: '2026-02-02T00:00:00.100Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '先修列表同步' }]
      }
    },
    {
      timestamp: '2026-02-02T00:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        content: [{ type: 'output_text', text: '先看状态。' }]
      }
    },
    {
      timestamp: '2026-02-02T00:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '再把移动端 UI 分开' }]
      }
    },
    {
      timestamp: '2026-02-02T00:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call-1',
        arguments: JSON.stringify({ cmd: 'rg steer client/src' })
      }
    },
    {
      timestamp: '2026-02-02T00:00:03.500Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'Process exited with code 0\nOutput:\nclient/src/App.jsx:steer'
      }
    }
  ].map((entry) => JSON.stringify(entry)).join('\n');

  const activities = rawSessionActivitiesFromJsonl(content, turnWindow);

  assert.deepEqual(
    activities.map((item) => [item.activity.kind, item.segmentIndex ?? 0]),
    [
      ['agent_message', 0],
      ['command_execution', 1]
    ]
  );
});

test('rawSessionActivitiesFromJsonl ignores AGENTS instruction rows when assigning guided segments', () => {
  const turnWindow = [
    {
      id: 'turn-1',
      startedAt: Date.parse('2026-02-02T00:00:00.000Z') / 1000,
      completedAt: Date.parse('2026-02-02T00:00:10.000Z') / 1000
    }
  ];
  const content = [
    {
      timestamp: '2026-02-02T00:00:00.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\n...\n</INSTRUCTIONS>' }]
      }
    },
    {
      timestamp: '2026-02-02T00:00:00.010Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-1' }
    },
    {
      timestamp: '2026-02-02T00:00:00.100Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '跑一个长任务' }]
      }
    },
    {
      timestamp: '2026-02-02T00:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        content: [{ type: 'output_text', text: '先启动命令。' }]
      }
    },
    {
      timestamp: '2026-02-02T00:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call-1',
        arguments: JSON.stringify({ cmd: 'sleep 5' })
      }
    }
  ].map((entry) => JSON.stringify(entry)).join('\n');

  const activities = rawSessionActivitiesFromJsonl(content, turnWindow);

  assert.deepEqual(
    activities.map((item) => [item.activity.kind, item.segmentIndex ?? 0]),
    [
      ['agent_message', 0],
      ['command_execution', 0]
    ]
  );
});

test('rawSessionActivitiesFromJsonl keeps context compaction at its JSONL position', () => {
  const turnWindow = [
    {
      id: 'turn-1',
      startedAt: Date.parse('2026-02-02T00:00:00.000Z') / 1000,
      completedAt: Date.parse('2026-02-02T00:00:10.000Z') / 1000
    }
  ];
  const content = [
    {
      timestamp: '2026-02-02T00:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        content: [{ type: 'output_text', text: '先读取现状。' }]
      }
    },
    {
      timestamp: '2026-02-02T00:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call-1',
        arguments: JSON.stringify({ cmd: 'rg foo client/src' })
      }
    },
    {
      timestamp: '2026-02-02T00:00:02.500Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'Process exited with code 0\nOutput:\nclient/src/App.jsx:foo'
      }
    },
    {
      timestamp: '2026-02-02T00:00:03.000Z',
      type: 'compacted',
      payload: {}
    },
    {
      timestamp: '2026-02-02T00:00:03.001Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-1' }
    },
    {
      timestamp: '2026-02-02T00:00:04.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        content: [{ type: 'output_text', text: '再继续验证。' }]
      }
    }
  ].map((entry) => JSON.stringify(entry)).join('\n');

  const activities = rawSessionActivitiesFromJsonl(content, turnWindow);

  assert.deepEqual(
    activities.map((item) => item.activity.kind),
    ['agent_message', 'command_execution', 'context_compaction', 'agent_message']
  );
  assert.deepEqual(
    activities.map((item) => item.activity.label),
    ['先读取现状。', '本地任务已处理', '上下文已自动压缩', '再继续验证。']
  );
});
