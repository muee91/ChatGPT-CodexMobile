/**
 * 测试 git-panel-state.js：改动计数、安全警告与动作拦阻原因。
 * Keywords: git-state, safety, tests
 * Exports: 无导出 / 内含用例
 * Inward: git-panel-state.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { gitActionBlockReason, gitChangedFileCount, gitSafetyWarnings } from './git-panel-state.js';

test('gitChangedFileCount prefers server total over displayed file slice', () => {
  assert.equal(gitChangedFileCount({ fileCount: 5388, files: [{ path: 'a' }] }), 5388);
});

test('gitSafetyWarnings reports large truncated working trees clearly', () => {
  const warnings = gitSafetyWarnings({
    branch: 'main',
    fileCount: 5388,
    filesTruncated: true,
    files: Array.from({ length: 500 }, (_, index) => ({ path: `file-${index}` }))
  });

  assert.deepEqual(warnings, [
    '工作区有 5388 个改动文件',
    '仅显示前 500 个文件',
    '当前不是 codex/ 分支',
    '当前分支没有 upstream'
  ]);
});

test('gitActionBlockReason treats non-codex branches as warnings, not blocks', () => {
  assert.equal(
    gitActionBlockReason({ branch: 'main', canCommit: true, fileCount: 1 }, 'commit'),
    ''
  );
});

test('gitActionBlockReason treats huge dirty worktrees as warnings, not blocks', () => {
  assert.equal(
    gitActionBlockReason({ branch: 'codex/git-fix', canCommit: true, fileCount: 501 }, 'push'),
    ''
  );
});

test('gitActionBlockReason allows focused codex branch actions', () => {
  assert.equal(gitActionBlockReason({ branch: 'codex/git-fix', canCommit: true, fileCount: 3 }, 'commit'), '');
});

test('gitActionBlockReason still blocks missing branches and empty commits', () => {
  assert.equal(gitActionBlockReason({ canCommit: true }, 'push'), '当前不在有效 Git 分支上');
  assert.equal(gitActionBlockReason({ branch: 'main', canCommit: false }, 'commit'), '没有可提交的改动');
});
