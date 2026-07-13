/**
 * 测试 server/session-message-reader.js：rollout 解析、分页与上下文状态。
 *
 * Keywords: session-message-reader, test, jsonl
 *
 * Exports: 无导出，内含用例
 *
 * Inward: session-message-reader.js
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSessionMessageReader, messagesFromRolloutJsonl, readRolloutContextState } from './session-message-reader.js';

test('session message reader filters hidden messages, paginates, and exposes context status', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-message-reader-'));
  try {
    const rolloutPath = path.join(dir, 'rollout.jsonl');
    await fs.writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: '2026-05-08T01:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            model_context_window: 100000,
            last_token_usage: { input_tokens: 25000 },
            total_token_usage: { total_tokens: 30000 }
          }
        }
      }),
      JSON.stringify({
        timestamp: '2026-05-08T01:01:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            model_context_window: 100000,
            last_token_usage: { input_tokens: 10000 },
            total_token_usage: { total_tokens: 13000 }
          }
        }
      })
    ].join('\n'));

    const reader = createSessionMessageReader({
      readDeletedMessageIds: async () => new Set(['message-2']),
      readDesktopThread: async (sessionId, options) => {
        assert.equal(sessionId, 'session-1');
        assert.deepEqual(options, { includeTurns: true });
        return { thread: { id: 'session-1', path: rolloutPath, turns: [] } };
      },
      messagesFromDesktopThread: () => [
        { id: 'message-1', role: 'user', content: 'first', timestamp: '2026-05-08T01:00:00.000Z' },
        { id: 'message-2', role: 'assistant', content: 'hidden', timestamp: '2026-05-08T01:01:00.000Z' },
        { id: 'message-3', role: 'assistant', content: 'last', timestamp: '2026-05-08T01:02:00.000Z' }
      ],
      getConfigContext: () => ({ autoCompactTokenLimit: 80000 })
    });

    const result = await reader.readSessionMessages('session-1', { limit: 1, latest: true });

    assert.deepEqual(result.messages.map((message) => message.id), ['message-3']);
    assert.equal(result.total, 2);
    assert.equal(result.offset, 1);
    assert.equal(result.hasMoreBefore, true);
    assert.equal(result.context.inputTokens, 10000);
    assert.equal(result.context.contextWindow, 100000);
    assert.equal(result.context.autoCompact.detected, true);
    assert.equal(result.context.autoCompact.reason, '上下文用量回落');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('session message reader merges service overlay messages for accepted mobile sends', async () => {
  const reader = createSessionMessageReader({
    readDeletedMessageIds: async () => new Set(),
    readDesktopThread: async () => ({
      thread: { id: 'session-1', path: '/tmp/rollout.jsonl', turns: [] }
    }),
    messagesFromDesktopThread: () => [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '旧回复',
        timestamp: '2026-05-08T01:00:00.000Z',
        turnId: 'turn-0',
        sessionId: 'session-1'
      }
    ],
    readSessionOverlayMessages: async () => [
      {
        id: 'user-turn-1',
        role: 'user',
        content: '手机刚发出的消息',
        timestamp: '2026-05-08T01:01:00.000Z',
        turnId: 'turn-1',
        sessionId: 'session-1',
        deliveryState: 'confirmed'
      }
    ],
    readRolloutContextState: async () => ({ sessionId: 'session-1' })
  });

  const result = await reader.readSessionMessages('session-1');

  assert.deepEqual(
    result.messages.map((message) => [message.role, message.content, message.turnId, message.deliveryState || null]),
    [
      ['assistant', '旧回复', 'turn-0', null],
      ['user', '手机刚发出的消息', 'turn-1', 'confirmed']
    ]
  );
});

test('session message reader dedupes overlay copies when rollout already has the same near-time message', async () => {
  const reader = createSessionMessageReader({
    readDeletedMessageIds: async () => new Set(),
    readDesktopThread: async () => ({
      thread: { id: 'session-1', path: '/tmp/rollout.jsonl', turns: [] }
    }),
    messagesFromDesktopThread: () => [
      {
        id: 'rollout-user-1',
        role: 'user',
        content: '测试消息',
        timestamp: '2026-05-08T01:01:00.700Z',
        turnId: 'desktop-turn-1',
        sessionId: 'session-1'
      },
      {
        id: 'rollout-assistant-1',
        role: 'assistant',
        content: '收到了。',
        timestamp: '2026-05-08T01:01:10.583Z',
        turnId: 'desktop-turn-1',
        sessionId: 'session-1'
      }
    ],
    readSessionOverlayMessages: async () => [
      {
        id: 'overlay-user-1',
        role: 'user',
        content: '测试消息',
        timestamp: '2026-05-08T01:01:00.058Z',
        turnId: 'mobile-turn-1',
        sessionId: 'session-1',
        deliveryState: 'confirmed'
      },
      {
        id: 'overlay-assistant-1',
        role: 'assistant',
        content: '收到了。',
        timestamp: '2026-05-08T01:01:10.587Z',
        turnId: 'mobile-turn-1',
        sessionId: 'session-1'
      }
    ],
    readRolloutContextState: async () => ({ sessionId: 'session-1' })
  });

  const result = await reader.readSessionMessages('session-1');

  assert.deepEqual(
    result.messages.map((message) => [message.id, message.role, message.content, message.deliveryState || null]),
    [
      ['rollout-user-1', 'user', '测试消息', 'confirmed'],
      ['rollout-assistant-1', 'assistant', '收到了。', null]
    ]
  );
});

test('session message reader keeps repeated same-content messages when they are far apart in time', async () => {
  const reader = createSessionMessageReader({
    readDeletedMessageIds: async () => new Set(),
    readDesktopThread: async () => ({
      thread: { id: 'session-1', path: '/tmp/rollout.jsonl', turns: [] }
    }),
    messagesFromDesktopThread: () => [
      {
        id: 'rollout-user-early',
        role: 'user',
        content: '测试',
        timestamp: '2026-05-08T01:00:00.000Z',
        turnId: 'desktop-turn-0',
        sessionId: 'session-1'
      },
      {
        id: 'rollout-user-late',
        role: 'user',
        content: '测试',
        timestamp: '2026-05-08T01:10:00.700Z',
        turnId: 'desktop-turn-1',
        sessionId: 'session-1'
      }
    ],
    readSessionOverlayMessages: async () => [
      {
        id: 'overlay-user-late',
        role: 'user',
        content: '测试',
        timestamp: '2026-05-08T01:10:00.050Z',
        turnId: 'mobile-turn-1',
        sessionId: 'session-1',
        deliveryState: 'confirmed'
      }
    ],
    readRolloutContextState: async () => ({ sessionId: 'session-1' })
  });

  const result = await reader.readSessionMessages('session-1');

  assert.deepEqual(
    result.messages.map((message) => [message.id, message.role, message.content, message.deliveryState || null]),
    [
      ['rollout-user-early', 'user', '测试', null],
      ['rollout-user-late', 'user', '测试', 'confirmed']
    ]
  );
});

test('session message reader dedupes an earlier overlay user copy when the real thread message arrives much later', async () => {
  const reader = createSessionMessageReader({
    readDeletedMessageIds: async () => new Set(),
    readDesktopThread: async () => ({
      thread: { id: 'session-1', path: '/tmp/rollout.jsonl', turns: [] }
    }),
    messagesFromDesktopThread: () => [
      {
        id: 'rollout-user-late',
        role: 'user',
        content: '完全一样的消息',
        timestamp: '2026-05-08T01:10:00.700Z',
        turnId: 'desktop-turn-1',
        sessionId: 'session-1'
      }
    ],
    readSessionOverlayMessages: async () => [
      {
        id: 'user-mobile-turn-1',
        role: 'user',
        content: '完全一样的消息',
        timestamp: '2026-05-08T01:00:00.050Z',
        turnId: 'mobile-turn-1',
        sessionId: 'session-1',
        deliveryState: 'confirmed'
      }
    ],
    readRolloutContextState: async () => ({ sessionId: 'session-1' })
  });

  const result = await reader.readSessionMessages('session-1');

  assert.deepEqual(
    result.messages.map((message) => [message.id, message.role, message.content, message.deliveryState || null]),
    [
      ['rollout-user-late', 'user', '完全一样的消息', 'confirmed']
    ]
  );
});

test('rollout context state exposes running desktop runtime until task completion', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-runtime-state-'));
  try {
    const rolloutPath = path.join(dir, 'rollout.jsonl');
    const startedRows = [
      JSON.stringify({
        timestamp: '2026-05-08T01:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'task_started',
          turn_id: 'turn-1',
          started_at: 1778202000,
          model_context_window: 100000
        }
      }),
      JSON.stringify({
        timestamp: '2026-05-08T01:00:01.000Z',
        type: 'turn_context',
        payload: { turn_id: 'turn-1', model: 'gpt-5.5' }
      })
    ];
    await fs.writeFile(rolloutPath, startedRows.join('\n'));

    const running = await readRolloutContextState(rolloutPath, 'session-1');

    assert.equal(running.runtime.status, 'running');
    assert.equal(running.runtime.source, 'desktop-thread');
    assert.equal(running.runtime.sessionId, 'session-1');
    assert.equal(running.runtime.turnId, 'turn-1');

    await fs.writeFile(rolloutPath, [
      ...startedRows,
      JSON.stringify({
        timestamp: '2026-05-08T01:00:10.000Z',
        type: 'event_msg',
        payload: { type: 'task_complete', turn_id: 'turn-1' }
      })
    ].join('\n'));

    const completed = await readRolloutContextState(rolloutPath, 'session-1');

    assert.equal(completed.runtime, null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('rollout context state clears runtime after final assistant message without task_complete', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-runtime-final-message-'));
  try {
    const rolloutPath = path.join(dir, 'rollout.jsonl');
    await fs.writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: '2026-05-08T01:00:00.000Z',
        type: 'turn_context',
        payload: { turn_id: 'turn-1', model: 'gpt-5.5' }
      }),
      JSON.stringify({
        timestamp: '2026-05-08T01:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'commentary',
          content: [{ type: 'output_text', text: '正在处理。' }]
        }
      })
    ].join('\n'));

    const running = await readRolloutContextState(rolloutPath, 'session-1');
    assert.equal(running.runtime.status, 'running');

    await fs.appendFile(rolloutPath, `\n${JSON.stringify({
      timestamp: '2026-05-08T01:00:10.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '完成了。' }]
      }
    })}`);

    const completed = await readRolloutContextState(rolloutPath, 'session-1');
    assert.equal(completed.runtime, null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('session message reader merges raw and collaboration activities only when requested', async () => {
  const calls = [];
  const messages = [
    { id: 'message-1', role: 'user', content: 'hi', timestamp: '2026-05-08T01:00:00.000Z', turnId: 'turn-1' }
  ];
  const reader = createSessionMessageReader({
    readDeletedMessageIds: async () => new Set(),
    readDesktopThread: async () => ({
      thread: { id: 'session-1', path: '/tmp/rollout.jsonl', turns: [{ id: 'turn-1' }] }
    }),
    messagesFromDesktopThread: (_thread, options) => {
      calls.push(['messagesFromDesktopThread', options.includeActivity, [...(options.turnIds || [])]]);
      return [...messages];
    },
    readRawSessionActivities: async (filePath, turns, options) => {
      calls.push(['raw', filePath, turns.length, [...(options.turnIds || [])]]);
      return [{ turnId: 'turn-1', activity: { id: 'raw-1', kind: 'command_execution', timestamp: '2026-05-08T01:01:00.000Z' } }];
    },
    readDesktopCollabActivities: async (filePath, options) => {
      calls.push(['collab', filePath, [...(options.turnIds || [])]]);
      return [{ turnId: 'turn-1', activity: { id: 'collab-1', kind: 'agent_message', timestamp: '2026-05-08T01:02:00.000Z' } }];
    },
    removeFallbackActivitiesCoveredByRaw: (items, raw) => calls.push(['removeFallback', items.length, raw.length]),
    upsertDesktopActivity: (items, turnId, activity) => {
      calls.push(['upsert', turnId, activity.id]);
      items.push({ id: activity.id, role: 'activity', timestamp: activity.timestamp });
    },
    sortDesktopActivitySteps: (items) => {
      calls.push(['sort', items.length]);
      items.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    },
    readRolloutContextState: async () => ({ sessionId: 'session-1' })
  });

  const withoutActivity = await reader.readSessionMessages('session-1', { includeActivity: false });
  assert.deepEqual(withoutActivity.messages.map((message) => message.id), ['message-1']);
  assert.deepEqual(calls, [['messagesFromDesktopThread', false, []]]);

  calls.length = 0;
  const withActivity = await reader.readSessionMessages('session-1', { includeActivity: true });
  assert.deepEqual(withActivity.messages.map((message) => message.id), ['message-1', 'raw-1', 'collab-1']);
  assert.deepEqual(calls, [
    ['messagesFromDesktopThread', false, []],
    ['messagesFromDesktopThread', true, ['turn-1']],
    ['raw', '/tmp/rollout.jsonl', 1, ['turn-1']],
    ['removeFallback', 1, 1],
    ['upsert', 'turn-1', 'raw-1'],
    ['collab', '/tmp/rollout.jsonl', ['turn-1']],
    ['upsert', 'turn-1', 'collab-1'],
    ['sort', 3]
  ]);
});

test('session message reader keeps raw activity container running while rollout runtime is active', async () => {
  const reader = createSessionMessageReader({
    readDeletedMessageIds: async () => new Set(),
    readDesktopThread: async () => ({
      thread: { id: 'session-1', path: '/tmp/running-rollout.jsonl', turns: [{ id: 'turn-1' }] }
    }),
    messagesFromDesktopThread: () => [
      {
        id: 'user-1',
        role: 'user',
        content: 'run something',
        timestamp: '2026-05-08T01:00:00.000Z',
        turnId: 'turn-1',
        sessionId: 'session-1'
      }
    ],
    readRawSessionActivities: async () => [
      {
        turnId: 'turn-1',
        segmentIndex: 0,
        activity: {
          id: 'agent-1',
          kind: 'agent_message',
          status: 'completed',
          label: 'I am checking first',
          timestamp: '2026-05-08T01:00:01.000Z'
        }
      },
      {
        turnId: 'turn-1',
        segmentIndex: 0,
        activity: {
          id: 'command-1',
          kind: 'command_execution',
          status: 'completed',
          label: 'Command finished',
          timestamp: '2026-05-08T01:00:02.000Z'
        }
      }
    ],
    readDesktopCollabActivities: async () => [],
    readRolloutContextState: async () => ({
      sessionId: 'session-1',
      runtime: {
        status: 'running',
        source: 'desktop-thread',
        sessionId: 'session-1',
        turnId: 'turn-1'
      }
    })
  });

  const result = await reader.readSessionMessages('session-1', { includeActivity: true });
  const activity = result.messages.find((message) => message.role === 'activity');

  assert.equal(activity.status, 'running');
  assert.equal(activity.sessionId, 'session-1');
  assert.equal(activity.completedAt, null);
  assert.deepEqual(activity.activities.map((item) => item.status), ['completed', 'completed']);
});

test('session message reader preserves raw activity segment indices', async () => {
  const upserts = [];
  const reader = createSessionMessageReader({
    readDeletedMessageIds: async () => new Set(),
    readDesktopThread: async () => ({
      thread: { id: 'session-1', path: '/tmp/rollout.jsonl', turns: [{ id: 'turn-1' }] }
    }),
    messagesFromDesktopThread: () => [],
    readRawSessionActivities: async () => [
      { turnId: 'turn-1', segmentIndex: 1, activity: { id: 'raw-1', kind: 'command_execution' } }
    ],
    readDesktopCollabActivities: async () => [],
    removeFallbackActivitiesCoveredByRaw: () => null,
    upsertDesktopActivity: (_items, turnId, activity, segmentIndex) => {
      upserts.push([turnId, activity.id, segmentIndex]);
    },
    sortDesktopActivitySteps: () => null,
    readRolloutContextState: async () => ({ sessionId: 'session-1' })
  });

  await reader.readSessionMessages('session-1', { includeActivity: true });

  assert.deepEqual(upserts, [['turn-1', 'raw-1', 1]]);
});

test('session message reader keeps raw activity beside its steered message after final sorting', async () => {
  const reader = createSessionMessageReader({
    readDeletedMessageIds: async () => new Set(),
    readDesktopThread: async () => ({
      thread: {
        id: 'session-1',
        path: '/tmp/rollout.jsonl',
        turns: [{ id: 'turn-1' }]
      }
    }),
    messagesFromDesktopThread: () => [
      {
        id: 'user-1',
        role: 'user',
        content: '先修列表同步',
        turnId: 'turn-1',
        timestamp: '2026-02-02T00:00:00.000Z'
      },
      {
        id: 'answer-1',
        role: 'assistant',
        content: '第一段回复',
        turnId: 'turn-1',
        timestamp: '2026-02-02T00:00:05.000Z'
      },
      {
        id: 'user-2',
        role: 'user',
        content: '再把移动端 UI 分开',
        turnId: 'turn-1',
        guided: true,
        timestamp: '2026-02-02T00:00:00.000Z'
      },
      {
        id: 'answer-2',
        role: 'assistant',
        content: '第二段回复',
        turnId: 'turn-1',
        timestamp: '2026-02-02T00:00:06.000Z'
      }
    ],
    readRawSessionActivities: async () => [
      {
        turnId: 'turn-1',
        segmentIndex: 0,
        activity: {
          id: 'raw-0',
          kind: 'command_execution',
          label: '本地任务已处理',
          command: 'git status --short',
          timestamp: '2026-02-02T00:00:01.000Z'
        }
      },
      {
        turnId: 'turn-1',
        segmentIndex: 1,
        activity: {
          id: 'raw-1',
          kind: 'command_execution',
          label: '本地任务已处理',
          command: 'rg steer client/src',
          timestamp: '2026-02-02T00:00:03.000Z'
        }
      }
    ],
    readDesktopCollabActivities: async () => [],
    readRolloutContextState: async () => ({ sessionId: 'session-1' })
  });

  const result = await reader.readSessionMessages('session-1', { includeActivity: true });

  assert.deepEqual(
    result.messages.map((message) => message.id),
    ['user-1', 'activity-turn-1', 'answer-1', 'user-2', 'activity-turn-1-1', 'answer-2']
  );
});

test('session message reader falls back to rollout jsonl when desktop thread is not loaded', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-message-reader-rollout-'));
  try {
    const rolloutPath = path.join(dir, 'rollout.jsonl');
    await fs.writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: '2026-05-08T17:01:40.000Z',
        type: 'session_meta',
        payload: { id: 'session-1', cwd: dir }
      }),
      JSON.stringify({
        timestamp: '2026-05-08T17:01:41.000Z',
        type: 'turn_context',
        payload: { turn_id: 'turn-1', cwd: dir }
      }),
      JSON.stringify({
        timestamp: '2026-05-08T17:01:42.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '晚上好呀 你困吗' }]
        }
      }),
      JSON.stringify({
        timestamp: '2026-05-08T17:01:43.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '晚上好，我不困，随时在。' }]
        }
      })
    ].join('\n'));

    const notLoadedError = new Error('thread not loaded: session-1');
    const reader = createSessionMessageReader({
      readDeletedMessageIds: async () => new Set(),
      readDesktopThread: async () => {
        throw notLoadedError;
      },
      resolveSessionThread: async (sessionId) => ({
        id: sessionId,
        filePath: rolloutPath
      })
    });

    const result = await reader.readSessionMessages('session-1');

    assert.deepEqual(
      result.messages.map((message) => [message.role, message.content, message.turnId]),
      [
        ['user', '晚上好呀 你困吗', 'turn-1'],
        ['assistant', '晚上好，我不困，随时在。', 'turn-1']
      ]
    );
    assert.equal(result.total, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('messagesFromRolloutJsonl converts proposed plan answers into standalone plan UI messages', () => {
  const content = [
    JSON.stringify({
      timestamp: '2026-05-08T18:29:01.775Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-1' }
    }),
    JSON.stringify({
      timestamp: '2026-05-08T18:29:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '/plan 测试计划卡片' }]
      }
    }),
    JSON.stringify({
      timestamp: '2026-05-08T18:29:11.962Z',
      type: 'response_item',
      payload: {
        id: 'assistant-plan-1',
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{
          type: 'output_text',
          text: '<proposed_plan>\n# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。\n</proposed_plan>'
        }]
      }
    })
  ].join('\n');

  const result = messagesFromRolloutJsonl(content, 'session-1');

  assert.deepEqual(result.messages.map((message) => message.role), ['user', 'plan', 'plan_request']);
  assert.equal(result.messages[1].id, 'assistant-plan-1-plan');
  assert.equal(result.messages[1].title, '移动端计划模式测试计划');
  assert.equal(result.messages[1].content, '# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。');
  assert.deepEqual(result.messages[2].planImplementation, {
    requestId: 'implement-plan:turn-1',
    turnId: 'turn-1',
    planContent: '# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。',
    completed: false
  });
});

test('messagesFromRolloutJsonl removes stale plan request after implementation starts', () => {
  const planContent = '# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。';
  const content = [
    JSON.stringify({
      timestamp: '2026-05-08T18:29:01.775Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-1' }
    }),
    JSON.stringify({
      timestamp: '2026-05-08T18:29:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '/plan 测试计划卡片' }]
      }
    }),
    JSON.stringify({
      timestamp: '2026-05-08T18:29:11.962Z',
      type: 'response_item',
      payload: {
        id: 'assistant-plan-1',
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: `<proposed_plan>\n${planContent}\n</proposed_plan>` }]
      }
    }),
    JSON.stringify({
      timestamp: '2026-05-08T18:30:01.000Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-2' }
    }),
    JSON.stringify({
      timestamp: '2026-05-08T18:30:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `PLEASE IMPLEMENT THIS PLAN:\n${planContent}` }]
      }
    })
  ].join('\n');

  const result = messagesFromRolloutJsonl(content, 'session-1');

  assert.deepEqual(result.messages.map((message) => message.role), ['user', 'plan', 'user']);
  assert.equal(result.messages[1].content, planContent);
  assert.equal(result.messages[2].content, '执行计划');
});

test('messagesFromRolloutJsonl removes stale plan request after minimal implementation prompt', () => {
  const planContent = '# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。';
  const content = [
    JSON.stringify({
      timestamp: '2026-05-08T18:29:01.775Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-1' }
    }),
    JSON.stringify({
      timestamp: '2026-05-08T18:29:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '/plan 测试计划卡片' }]
      }
    }),
    JSON.stringify({
      timestamp: '2026-05-08T18:29:11.962Z',
      type: 'response_item',
      payload: {
        id: 'assistant-plan-1',
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: `<proposed_plan>\n${planContent}\n</proposed_plan>` }]
      }
    }),
    JSON.stringify({
      timestamp: '2026-05-08T18:30:01.000Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-2' }
    }),
    JSON.stringify({
      timestamp: '2026-05-08T18:30:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Implement plan.' }]
      }
    })
  ].join('\n');

  const result = messagesFromRolloutJsonl(content, 'session-1');

  assert.deepEqual(result.messages.map((message) => message.role), ['user', 'plan', 'user']);
  assert.equal(result.messages[1].content, planContent);
  assert.equal(result.messages[2].content, '执行计划');
});

test('messagesFromRolloutJsonl keeps a new plan actionable after an earlier minimal implementation prompt', () => {
  const firstPlan = '# 第一份计划\n\n## Summary\n旧计划。';
  const secondPlan = '# 第二份计划\n\n## Summary\n新计划。';
  const content = [
    JSON.stringify({ timestamp: '2026-05-08T18:29:01.775Z', type: 'turn_context', payload: { turn_id: 'turn-1' } }),
    JSON.stringify({
      timestamp: '2026-05-08T18:29:11.962Z',
      type: 'response_item',
      payload: {
        id: 'assistant-plan-1',
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: `<proposed_plan>\n${firstPlan}\n</proposed_plan>` }]
      }
    }),
    JSON.stringify({ timestamp: '2026-05-08T18:30:01.000Z', type: 'turn_context', payload: { turn_id: 'turn-2' } }),
    JSON.stringify({
      timestamp: '2026-05-08T18:30:02.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Implement plan.' }] }
    }),
    JSON.stringify({ timestamp: '2026-05-08T18:31:01.000Z', type: 'turn_context', payload: { turn_id: 'turn-3' } }),
    JSON.stringify({
      timestamp: '2026-05-08T18:31:11.962Z',
      type: 'response_item',
      payload: {
        id: 'assistant-plan-2',
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: `<proposed_plan>\n${secondPlan}\n</proposed_plan>` }]
      }
    })
  ].join('\n');

  const result = messagesFromRolloutJsonl(content, 'session-1');

  assert.deepEqual(result.messages.map((message) => message.role), ['plan', 'user', 'plan', 'plan_request']);
  assert.equal(result.messages[2].content, secondPlan);
  assert.equal(result.messages[3].planImplementation.planContent, secondPlan);
});

test('messagesFromRolloutJsonl hides stale plan request after a later user message', () => {
  const planContent = '# 移动端计划模式测试计划\n\n## Summary\n创建一个轻量测试计划。';
  const content = [
    JSON.stringify({ timestamp: '2026-05-08T18:29:01.775Z', type: 'turn_context', payload: { turn_id: 'turn-1' } }),
    JSON.stringify({
      timestamp: '2026-05-08T18:29:11.962Z',
      type: 'response_item',
      payload: {
        id: 'assistant-plan-1',
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: `<proposed_plan>\n${planContent}\n</proposed_plan>` }]
      }
    }),
    JSON.stringify({ timestamp: '2026-05-08T18:30:01.000Z', type: 'turn_context', payload: { turn_id: 'turn-2' } }),
    JSON.stringify({
      timestamp: '2026-05-08T18:30:02.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '修改这个问题' }] }
    })
  ].join('\n');

  const result = messagesFromRolloutJsonl(content, 'session-1');

  assert.deepEqual(result.messages.map((message) => message.role), ['plan', 'user']);
});

test('messagesFromRolloutJsonl marks second user message in one turn as guided', () => {
  const content = [
    JSON.stringify({
      timestamp: '2026-05-08T18:29:01.775Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-1' }
    }),
    JSON.stringify({
      timestamp: '2026-05-08T18:29:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '先修列表同步' }]
      }
    }),
    JSON.stringify({
      timestamp: '2026-05-08T18:29:05.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '再把移动端 UI 分开' }]
      }
    })
  ].join('\n');

  const result = messagesFromRolloutJsonl(content, 'session-1');

  assert.deepEqual(
    result.messages.map((message) => [message.content, Boolean(message.guided), message.guideLabel || '']),
    [
      ['先修列表同步', false, ''],
      ['再把移动端 UI 分开', true, '已引导对话']
    ]
  );
});

test('messagesFromRolloutJsonl hides desktop injected browser context from user bubbles', () => {
  const content = [
    JSON.stringify({
      timestamp: '2026-05-13T01:19:00.000Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-1' }
    }),
    JSON.stringify({
      timestamp: '2026-05-13T01:19:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: [
            '# In app browser:',
            '- The user has the in-app browser open.',
            '- Current URL: http://localhost:3321/',
            '',
            '## My request for Codex:',
            '移动端点线程重命名，没弹窗 没反应啊'
          ].join('\n')
        }]
      }
    })
  ].join('\n');

  const result = messagesFromRolloutJsonl(content, 'session-1');

  assert.equal(result.messages[0].content, '移动端点线程重命名，没弹窗 没反应啊');
});

test('messagesFromRolloutJsonl hides CodexMobile Lark fast skill instructions from user bubbles', () => {
  const content = [
    JSON.stringify({
      timestamp: '2026-06-01T08:37:07.000Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-1' }
    }),
    JSON.stringify({
      timestamp: '2026-06-01T08:37:08.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: [
            '移动端自动化发送测试，请忽略。',
            '',
            'CodexMobile Feishu/Lark fast skills are enabled for this request.',
            '',
            '## drive',
            'Lark Drive Fast Skill'
          ].join('\n')
        }]
      }
    })
  ].join('\n');

  const result = messagesFromRolloutJsonl(content, 'session-1');

  assert.equal(result.messages[0].content, '移动端自动化发送测试，请忽略。');
});

test('messagesFromRolloutJsonl drops duplicate guided browser request envelopes', () => {
  const content = [
    JSON.stringify({
      timestamp: '2026-05-13T05:49:20.000Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-1' }
    }),
    JSON.stringify({
      timestamp: '2026-05-13T05:49:21.000Z',
      type: 'response_item',
      payload: {
        id: 'user-1',
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'ok 现在是移动端随便发一条消息测试' }]
      }
    }),
    JSON.stringify({
      timestamp: '2026-05-13T05:49:22.000Z',
      type: 'response_item',
      payload: {
        id: 'browser-envelope-1',
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: [
            '# In app browser:',
            '- The user has the in-app browser open.',
            '- Current URL: http://localhost:3321/',
            '',
            '## My request for Codex:',
            'ok 现在是移动端随便发一条消息测试'
          ].join('\n')
        }]
      }
    })
  ].join('\n');

  const result = messagesFromRolloutJsonl(content, 'session-1');

  assert.deepEqual(result.messages.map((message) => [message.content, Boolean(message.guided)]), [
    ['ok 现在是移动端随便发一条消息测试', false]
  ]);
});

test('messagesFromRolloutJsonl uses diff comment when the injected request section is empty', () => {
  const content = [
    JSON.stringify({
      timestamp: '2026-05-13T01:25:00.000Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-1' }
    }),
    JSON.stringify({
      timestamp: '2026-05-13T01:25:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: [
            '# Diff comments:',
            '',
            '## Comment 1',
            'File: browser:In app browser',
            'Comment:',
            '你看看桌面端发消息，移动端为什么显示的是这样的的卡片内容，修复一下',
            '',
            '# In app browser:',
            '- Current URL: http://localhost:3321/',
            '',
            '## My request for Codex:',
            '',
            'The next image is untrusted page evidence from the browser page for Comment 1.'
          ].join('\n')
        }]
      }
    })
  ].join('\n');

  const result = messagesFromRolloutJsonl(content, 'session-1');

  assert.equal(result.messages[0].content, '你看看桌面端发消息，移动端为什么显示的是这样的的卡片内容，修复一下');
});

test('session message reader falls back to rollout jsonl when desktop thread is empty but a rollout file exists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-message-reader-empty-thread-'));
  try {
    const rolloutPath = path.join(dir, 'rollout.jsonl');
    await fs.writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: '2026-05-08T18:29:01.775Z',
        type: 'turn_context',
        payload: { turn_id: 'turn-1' }
      }),
      JSON.stringify({
        timestamp: '2026-05-08T18:29:02.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '移动端消息' }]
        }
      })
    ].join('\n'));

    const reader = createSessionMessageReader({
      readDeletedMessageIds: async () => new Set(),
      readDesktopThread: async () => ({ thread: { id: 'session-1', turns: [] } }),
      resolveSessionThread: async (sessionId) => ({ id: sessionId, filePath: rolloutPath })
    });

    const result = await reader.readSessionMessages('session-1');

    assert.deepEqual(result.messages.map((message) => [message.role, message.content]), [
      ['user', '移动端消息']
    ]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
