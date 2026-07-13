/**
 * 测试 chat/ActivityFileSummary.jsx：apply_patch diff 行也要能区分新增与删除。
 * Keywords: activity-file-summary, diff, tests
 * Exports: 无导出 / 内含用例
 * Inward: chat/activity-diff-lines.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUnifiedDiffLines } from './chat/activity-diff-lines.js';

test('parseUnifiedDiffLines classifies apply_patch hunks without line numbers', () => {
  const rows = parseUnifiedDiffLines([
    '@@',
    '-  const oldValue = true;',
    '+  const newValue = true;',
    '+  const extraValue = true;',
    '   return value;'
  ].join('\n'));

  assert.deepEqual(rows.map((row) => [row.type, row.marker, row.text]), [
    ['hunk', '', '@@'],
    ['del', '-', '  const oldValue = true;'],
    ['add', '+', '  const newValue = true;'],
    ['add', '+', '  const extraValue = true;'],
    ['ctx', ' ', '  return value;']
  ]);
});

test('parseUnifiedDiffLines keeps standard unified diff line numbers', () => {
  const rows = parseUnifiedDiffLines([
    '@@ -10,2 +10,2 @@',
    '-old',
    '+new',
    ' same'
  ].join('\n'));

  assert.deepEqual(rows.map((row) => [row.type, row.oldLine, row.newLine, row.marker]), [
    ['hunk', '', '', undefined],
    ['del', 10, '', '-'],
    ['add', '', 10, '+'],
    ['ctx', 11, 11, ' ']
  ]);
});
