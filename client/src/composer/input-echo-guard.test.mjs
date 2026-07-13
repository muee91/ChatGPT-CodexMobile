/**
 * 测试 composer/input-echo-guard.js：发送后忽略安卓输入法回灌的旧文本。
 * Keywords: composer, ime, stale-echo, tests
 * Exports: 无导出 / 内含用例
 * Inward: composer/input-echo-guard.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSubmittedInputGuard } from './input-echo-guard.js';

test('submitted input guard ignores one stale replay after the composer was cleared', () => {
  const guard = createSubmittedInputGuard();
  guard.markSubmitted('刚发出去的内容');

  assert.equal(
    guard.shouldIgnoreIncoming({
      currentInput: '',
      nextInput: '刚发出去的内容'
    }),
    true
  );
});

test('submitted input guard does not block normal new input', () => {
  const guard = createSubmittedInputGuard();
  guard.markSubmitted('旧内容');

  assert.equal(
    guard.shouldIgnoreIncoming({
      currentInput: '',
      nextInput: '新内容'
    }),
    false
  );
});

test('submitted input guard only consumes the stale replay once', () => {
  const guard = createSubmittedInputGuard();
  guard.markSubmitted('旧内容');

  assert.equal(
    guard.shouldIgnoreIncoming({
      currentInput: '',
      nextInput: '旧内容'
    }),
    true
  );
  assert.equal(
    guard.shouldIgnoreIncoming({
      currentInput: '',
      nextInput: '旧内容'
    }),
    false
  );
});
