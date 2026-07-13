/**
 * Git 面板动作到后端 HTTP 路径、方法与 body 的映射（含较长超时）。
 *
 * Keywords: git, API, routes, commit, push, branch
 *
 * Exports:
 * - gitActionRequestConfig — 给定 action 名返回 { path, options }。
 *
 * Inward: 无。
 *
 * Outward: GitPanel 与 git 相关请求封装。
 */

export function gitActionRequestConfig(action, {
  projectId,
  commitMessage = '',
  branchName = '',
  baseBranch = '',
  defaultBaseBranch = 'main',
  extraBody = {}
} = {}) {
  if (action === 'commit') {
    return { path: '/api/git/commit', options: { method: 'POST', body: { projectId, message: commitMessage }, timeoutMs: 70_000 } };
  }
  if (action === 'commit-push') {
    return { path: '/api/git/commit-push', options: { method: 'POST', body: { projectId, message: commitMessage }, timeoutMs: 130_000 } };
  }
  if (action === 'push') {
    return { path: '/api/git/push', options: { method: 'POST', body: { projectId }, timeoutMs: 130_000 } };
  }
  if (action === 'pull') {
    return { path: '/api/git/pull', options: { method: 'POST', body: { projectId }, timeoutMs: 130_000 } };
  }
  if (action === 'sync') {
    return { path: '/api/git/sync', options: { method: 'POST', body: { projectId }, timeoutMs: 130_000 } };
  }
  if (action === 'branch') {
    return { path: '/api/git/branch', options: { method: 'POST', body: { projectId, branchName } } };
  }
  if (action === 'checkout') {
    return { path: '/api/git/checkout', options: { method: 'POST', body: { projectId, branch: extraBody.branch } } };
  }
  if (action === 'worktree') {
    return {
      path: '/api/git/worktree',
      options: { method: 'POST', body: { projectId, branchName, baseBranch: baseBranch || defaultBaseBranch } }
    };
  }
  if (action === 'pr-draft') {
    return { path: '/api/git/pr-draft', options: { method: 'POST', body: { projectId, baseBranch: baseBranch || defaultBaseBranch } } };
  }
  return null;
}
