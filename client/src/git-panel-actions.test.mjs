/**
 * 测试 git-panel-actions.js：面板动作到 API 路径与参数配置。
 * Keywords: git, API-config, tests
 * Exports: 无导出 / 内含用例
 * Inward: git-panel-actions.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { gitActionRequestConfig } from './git-panel-actions.js';

test('git action request config maps visible panel actions to backend routes', () => {
  const base = { projectId: 'project-1', commitMessage: '更新 Git', branchName: 'codex/git', baseBranch: 'main' };

  assert.equal(gitActionRequestConfig('pull', base).path, '/api/git/pull');
  assert.equal(gitActionRequestConfig('sync', base).path, '/api/git/sync');
  assert.equal(gitActionRequestConfig('commit-push', base).path, '/api/git/commit-push');
  assert.equal(gitActionRequestConfig('branch', base).path, '/api/git/branch');
  assert.equal(gitActionRequestConfig('checkout', { ...base, extraBody: { branch: 'main' } }).path, '/api/git/checkout');
  assert.equal(gitActionRequestConfig('pr-draft', base).path, '/api/git/pr-draft');
});

test('git action request config includes required request bodies', () => {
  assert.deepEqual(gitActionRequestConfig('commit-push', {
    projectId: 'project-1',
    commitMessage: '更新移动端 Git 面板'
  }), {
    path: '/api/git/commit-push',
    options: {
      method: 'POST',
      body: { projectId: 'project-1', message: '更新移动端 Git 面板' },
      timeoutMs: 130_000
    }
  });
});
