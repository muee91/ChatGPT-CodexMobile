/**
 * 测试 client/src/chat/interaction-model.js：运行中审批/提问事件如何进入或离开聊天消息流。
 *
 * Keywords: interaction, chat-message, approval, user-input, test
 *
 * Exports: 无导出，内含用例
 *
 * Inward: interaction-model.js
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveInteractionRequestMessage,
  upsertInteractionRequestMessage
} from './interaction-model.js';

test('upsertInteractionRequestMessage inserts a pending interaction card message', () => {
  const messages = upsertInteractionRequestMessage([], {
    sessionId: 'thread-1',
    turnId: 'turn-1',
    timestamp: '2026-05-15T01:00:00.000Z',
    interaction: {
      id: 'interaction-1',
      kind: 'user_input',
      title: '检查方式',
      prompt: '更新检查要做到什么程度？',
      questions: [
        {
          id: 'check_method',
          question: '更新检查要做到什么程度？',
          options: [
            { label: '自动检查 + 手动更新', description: '设置页打开时检查。' },
            { label: '仅手动检查', description: '用户点击检查更新才请求。' }
          ]
        }
      ]
    }
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'interaction_request');
  assert.equal(messages[0].id, 'interaction-interaction-1');
  assert.equal(messages[0].interaction.status, 'pending');
  assert.equal(messages[0].interaction.questions[0].options[1].label, '仅手动检查');
});

test('resolveInteractionRequestMessage removes the handled request from chat', () => {
  const current = upsertInteractionRequestMessage([], {
    sessionId: 'thread-1',
    turnId: 'turn-1',
    interaction: {
      id: 'interaction-1',
      kind: 'command_approval',
      title: '允许执行命令？',
      prompt: 'npm test'
    }
  });

  const next = resolveInteractionRequestMessage(current, {
    interactionId: 'interaction-1',
    status: 'completed'
  });

  assert.deepEqual(next, []);
});
