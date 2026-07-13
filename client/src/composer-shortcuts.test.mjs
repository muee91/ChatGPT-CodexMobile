/**
 * 测试 composer-shortcuts.js：斜杠 token 检测、替换与指令过滤。
 * Keywords: composer, slash-commands, tests
 * Exports: 无导出 / 内含用例
 * Inward: composer-shortcuts.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectComposerToken,
  exactSlashCommandForInput,
  filteredSlashCommands,
  replaceComposerToken
} from './composer-shortcuts.js';

test('detectComposerToken finds slash, skill, and file tokens', () => {
  assert.deepEqual(detectComposerToken('/rev', 4), {
    type: 'slash',
    marker: '/',
    query: 'rev',
    start: 0,
    end: 4
  });
  assert.deepEqual(detectComposerToken('请用 $frontend', 12), {
    type: 'skill',
    marker: '$',
    query: 'frontend',
    start: 3,
    end: 12
  });
  assert.deepEqual(detectComposerToken('看 @server', 9), {
    type: 'file',
    marker: '@',
    query: 'server',
    start: 2,
    end: 9
  });
});

test('replaceComposerToken removes selected skill token without leaking it into text', () => {
  const text = '请用 $frontend 优化';
  const token = detectComposerToken(text, 12);
  assert.equal(replaceComposerToken(text, token, ''), '请用 优化');
});

test('filteredSlashCommands matches Chinese commands and English aliases', () => {
  assert.equal(filteredSlashCommands('状态')[0].id, 'status');
  assert.equal(filteredSlashCommands('compact')[0].id, 'compact');
  assert.equal(filteredSlashCommands('review')[0].id, 'review');
});

test('compact slash command is an action instead of a prompt shortcut', () => {
  const command = filteredSlashCommands('compact')[0];
  assert.equal(command.id, 'compact');
  assert.equal(command.action, 'compact-context');
  assert.equal(command.prompt, undefined);
});

test('exactSlashCommandForInput resolves bare slash commands only', () => {
  assert.equal(exactSlashCommandForInput('/compact')?.id, 'compact');
  assert.equal(exactSlashCommandForInput('/压缩上下文')?.id, 'compact');
  assert.equal(exactSlashCommandForInput('/compact 继续处理'), null);
});

test('filteredSlashCommands leaves plan mode to the plus menu', () => {
  assert.equal(filteredSlashCommands('plan').some((command) => command.id === 'plan'), false);
});
