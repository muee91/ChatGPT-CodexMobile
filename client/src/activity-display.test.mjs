/**
 * 测试 activity-display.js：思考中步骤识别与展示文案。
 * Keywords: activity, reasoning, tests
 * Exports: 无导出 / 内含用例
 * Inward: activity-display.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { isThinkingActivityStep, thinkingActivityText } from './activity-display.js';

test('isThinkingActivityStep exposes running reasoning as a visible step', () => {
  assert.equal(isThinkingActivityStep({ kind: 'reasoning', status: 'running', label: '正在思考' }), true);
});

test('isThinkingActivityStep does not keep completed reasoning live', () => {
  assert.equal(isThinkingActivityStep({ kind: 'reasoning', status: 'completed', label: '正在思考' }), false);
});

test('thinkingActivityText falls back to mobile thinking label', () => {
  assert.equal(thinkingActivityText({ kind: 'reasoning', status: 'running' }), '正在思考');
});
