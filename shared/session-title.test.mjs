/**
 * 测试 shared/session-title.js：临时标题与会话综合标题提炼。
 *
 * Keywords: session-title, provisionalSessionTitle, sessionTitleFromConversation, node:test
 *
 * Exports: 无导出 / 内含用例
 *
 * Inward: session-title.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { provisionalSessionTitle, sessionTitleFromConversation } from './session-title.js';

test('turns an imperative first message into a task-like provisional title', () => {
  assert.equal(provisionalSessionTitle('你试试mask 局部编辑可以吗'), 'mask 局部编辑');
  assert.equal(provisionalSessionTitle('帮我看一下移动端线程命名逻辑是什么'), '移动端线程命名逻辑');
});

test('uses the assistant result when the user message is only a follow-up confirmation', () => {
  assert.equal(provisionalSessionTitle('可以 按你说的来调整'), '新对话');
  assert.equal(
    sessionTitleFromConversation({
      userMessage: '可以 按你说的来调整',
      assistantMessage: '已调整：移动端线程命名逻辑改为临时标题，完成后自动提炼任务标题。'
    }),
    '移动端线程命名逻辑'
  );
});
