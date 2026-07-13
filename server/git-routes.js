/**
 * Git 相关 HTTP API：状态、diff、分支、提交与简单仓库操作。
 *
 * Keywords: git-routes, rest-api, git-service
 *
 * Exports:
 * - createGitRouteHandler — 需注入 gitService。
 *
 * Inward（本模块依赖/组装的关键符号）: http-utils、git-service 实例。
 *
 * Outward（谁在用/调用场景）: server/index。
 *
 * 不负责: GitService 内 subprocess 细节。
 */
import { readBody, sendJson } from './http-utils.js';

function sendGitError(res, error, fallback = 'Git operation failed') {
  const statusCode = error.statusCode || 500;
  sendJson(res, statusCode, { error: error.message || fallback });
}

export function createGitRouteHandler({ gitService }) {
  if (!gitService) {
    throw new Error('createGitRouteHandler requires gitService');
  }

  return async function handleGitApi(req, res, url) {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/git/')) {
      return false;
    }

    if (method === 'GET' && pathname === '/api/git/status') {
      const projectId = url.searchParams.get('projectId');
      try {
        sendJson(res, 200, { success: true, status: await gitService.status(projectId) });
      } catch (error) {
        console.warn(`[git] status failed project=${projectId || ''}: ${error.message}`);
        sendGitError(res, error, 'Failed to read Git status');
      }
      return true;
    }

    if (method === 'GET' && pathname === '/api/git/diff') {
      const projectId = url.searchParams.get('projectId');
      try {
        sendJson(res, 200, { success: true, diff: await gitService.diff(projectId) });
      } catch (error) {
        console.warn(`[git] diff failed project=${projectId || ''}: ${error.message}`);
        sendGitError(res, error, 'Failed to read Git diff');
      }
      return true;
    }

    if (method === 'GET' && pathname === '/api/git/branches') {
      const projectId = url.searchParams.get('projectId');
      try {
        sendJson(res, 200, { success: true, branches: await gitService.branches(projectId) });
      } catch (error) {
        console.warn(`[git] branches failed project=${projectId || ''}: ${error.message}`);
        sendGitError(res, error, 'Failed to read Git branches');
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/git/branch') {
      const body = await readBody(req);
      try {
        const result = await gitService.createBranch(body.projectId, body.branchName);
        sendJson(res, 200, { success: true, ...result });
      } catch (error) {
        console.warn(`[git] branch failed project=${body.projectId || ''}: ${error.message}`);
        sendGitError(res, error, 'Failed to create Git branch');
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/git/checkout') {
      const body = await readBody(req);
      try {
        const result = await gitService.checkout(body.projectId, body.branch);
        sendJson(res, 200, { success: true, ...result });
      } catch (error) {
        console.warn(`[git] checkout failed project=${body.projectId || ''}: ${error.message}`);
        sendGitError(res, error, 'Failed to checkout Git branch');
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/git/commit') {
      const body = await readBody(req);
      try {
        const result = await gitService.commit(body.projectId, body.message);
        sendJson(res, 200, { success: true, ...result });
      } catch (error) {
        console.warn(`[git] commit failed project=${body.projectId || ''}: ${error.message}`);
        sendGitError(res, error, 'Failed to commit Git changes');
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/git/push') {
      const body = await readBody(req);
      try {
        const result = await gitService.push(body.projectId, {
          remote: body.remote,
          branch: body.branch
        });
        sendJson(res, 200, { success: true, ...result });
      } catch (error) {
        console.warn(`[git] push failed project=${body.projectId || ''}: ${error.message}`);
        sendGitError(res, error, 'Failed to push Git branch');
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/git/pull') {
      const body = await readBody(req);
      try {
        const result = await gitService.pull(body.projectId, {
          remote: body.remote,
          branch: body.branch
        });
        sendJson(res, 200, { success: true, ...result });
      } catch (error) {
        console.warn(`[git] pull failed project=${body.projectId || ''}: ${error.message}`);
        sendGitError(res, error, 'Failed to pull Git branch');
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/git/sync') {
      const body = await readBody(req);
      try {
        const result = await gitService.sync(body.projectId);
        sendJson(res, 200, { success: true, ...result });
      } catch (error) {
        console.warn(`[git] sync failed project=${body.projectId || ''}: ${error.message}`);
        sendGitError(res, error, 'Failed to sync Git branch');
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/git/commit-push') {
      const body = await readBody(req);
      try {
        const result = await gitService.commitPush(body.projectId, body.message);
        sendJson(res, 200, { success: true, ...result });
      } catch (error) {
        console.warn(`[git] commit-push failed project=${body.projectId || ''}: ${error.message}`);
        sendGitError(res, error, 'Failed to commit and push Git changes');
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/git/worktree') {
      const body = await readBody(req);
      try {
        const result = await gitService.worktree(body.projectId, {
          branchName: body.branchName,
          baseBranch: body.baseBranch
        });
        sendJson(res, 200, { success: true, ...result });
      } catch (error) {
        console.warn(`[git] worktree failed project=${body.projectId || ''}: ${error.message}`);
        sendGitError(res, error, 'Failed to create Git worktree');
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/git/pr-draft') {
      const body = await readBody(req);
      try {
        const draft = await gitService.prDraft(body.projectId, {
          baseBranch: body.baseBranch
        });
        sendJson(res, 200, { success: true, draft });
      } catch (error) {
        console.warn(`[git] pr-draft failed project=${body.projectId || ''}: ${error.message}`);
        sendGitError(res, error, 'Failed to create PR draft');
      }
      return true;
    }

    sendJson(res, 404, { error: 'Git API route not found' });
    return true;
  };
}
