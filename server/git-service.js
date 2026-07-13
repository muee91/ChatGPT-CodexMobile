/**
 * 封装 git 命令执行与会话内 Git 状态摘要、提交文案辅助。
 *
 * Keywords: git-service, child-process, git-status, diff
 *
 * Exports:
 * - parseGitStatusShort — 解析 porcelain 状态。
 * - normalizeBranchName / defaultCommitMessage — 分支与默认提交说明。
 * - truncateGitOutput — 限制输出长度。
 * - createGitService — 可注入 getProject 的 Git 服务。
 *
 * Inward（本模块依赖/组装的关键符号）: child_process execFile/spawn、cwd 自 getProject。
 *
 * Outward（谁在用/调用场景）: git-routes、测试。
 *
 * 不负责: 远程推送鉴权策略。
 */
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_GIT_OUTPUT = 1024 * 1024;
const MAX_DIFF_CHARS = 80_000;
const MAX_STATUS_FILES = 500;

function serviceError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function basenameWithoutExtension(filePath = '') {
  const name = String(filePath || '').split('/').filter(Boolean).pop() || 'changes';
  return name.replace(/\.[^.]+$/, '') || name;
}

function titleWord(value = '') {
  const base = basenameWithoutExtension(value);
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .join(' ') || 'changes';
}

function gitError(error, fallback = 'Git 操作失败') {
  const message = String(error?.stderr || error?.stdout || error?.message || fallback).trim();
  const wrapped = serviceError(message || fallback, 500);
  wrapped.cause = error;
  return wrapped;
}

async function runGit(cwd, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: MAX_GIT_OUTPUT,
      env: process.env
    });
    return {
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || '')
    };
  } catch (error) {
    throw gitError(error);
  }
}

async function runGitCapped(cwd, args, { timeoutMs = DEFAULT_TIMEOUT_MS, maxChars = MAX_DIFF_CHARS } = {}) {
  return new Promise((resolve, reject) => {
    const limit = Math.max(1000, Number(maxChars) || MAX_DIFF_CHARS);
    const child = spawn('git', args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let truncated = false;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      const error = serviceError('Git diff 读取超时', 504);
      reject(error);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const text = String(chunk || '');
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdout.length < limit) {
        stdout += text.slice(0, limit - stdout.length);
      }
      if (stdout.length >= limit) {
        truncated = true;
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(gitError(error));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code) {
        reject(gitError({ stdout, stderr: stderr || `git exited with code ${code}` }));
        return;
      }
      resolve({ stdout, stderr, truncated, originalLength: stdoutBytes });
    });
  });
}

export function parseGitStatusShort(output = '', { maxFiles = MAX_STATUS_FILES } = {}) {
  const lines = String(output || '').split(/\r?\n/).filter(Boolean);
  const first = lines[0] || '';
  const branchMatch = first.match(/^##\s+([^.\s]+|\S+?)(?:\.\.\.(\S+))?(?:\s+\[(.+)\])?$/);
  const meta = branchMatch?.[3] || '';
  const ahead = Number(meta.match(/ahead\s+(\d+)/)?.[1] || 0);
  const behind = Number(meta.match(/behind\s+(\d+)/)?.[1] || 0);
  const fileLines = lines.filter((line) => !line.startsWith('## '));
  const fileLimit = Math.max(1, Number(maxFiles) || MAX_STATUS_FILES);
  const files = fileLines
    .slice(0, fileLimit)
    .map((line) => {
      const rawStatus = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const renamedPath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop().trim() : rawPath;
      const status = rawStatus === '??' ? '??' : rawStatus.replace(/\s/g, '') || rawStatus.trim();
      return {
        raw: line,
        status,
        path: renamedPath,
        originalPath: rawPath.includes(' -> ') ? rawPath.split(' -> ')[0].trim() : null
      };
    });

  return {
    branch: branchMatch?.[1] || null,
    upstream: branchMatch?.[2] || null,
    ahead,
    behind,
    clean: fileLines.length === 0,
    fileCount: fileLines.length,
    filesTruncated: fileLines.length > files.length,
    files,
    canCommit: fileLines.length > 0,
    canPush: Boolean(branchMatch?.[1]) && (ahead > 0 || Boolean(branchMatch?.[2]))
  };
}

export function normalizeBranchName(value = '', prefix = 'codex/') {
  const normalizedPrefix = String(prefix || 'codex/').replace(/^\/+|\/+$/g, '') || 'codex';
  const raw = String(value || '')
    .trim()
    .replace(/^codex\//i, '')
    .replace(/\.\.+/g, ' ')
    .replace(/[^\w/.-]+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/-+/g, '-')
    .replace(/^[./\-_]+|[./\-_]+$/g, '')
    .toLowerCase();
  const leaf = raw || 'git';
  return `${normalizedPrefix}/${leaf}`.replace(/\/+/g, '/');
}

export function defaultCommitMessage(status = {}) {
  const files = Array.isArray(status.files) ? status.files : [];
  if (!files.length) {
    return '更新项目';
  }
  const names = files.slice(0, 2).map((file) => titleWord(file.path));
  if (files.length === 1) {
    return `更新 ${names[0]}`;
  }
  if (files.length === 2) {
    return `更新 ${names[0]} 和 ${names[1]}`;
  }
  return `更新 ${names[0]} 等 ${files.length} 个文件`;
}

function sanitizeCommitMessage(value = '') {
  const message = String(value || '').replace(/\s+/g, ' ').trim();
  if (!message) {
    throw serviceError('提交信息不能为空', 400);
  }
  return message.slice(0, 200);
}

function sanitizeExistingBranchName(value = '') {
  const branch = String(value || '').trim();
  if (!branch || branch.startsWith('-') || branch.includes('..') || /[\s~^:?*[\]\\]/.test(branch)) {
    throw serviceError('分支名无效', 400);
  }
  return branch;
}

function ensureMobileSafeGitAction(current = {}) {
  if (!current.branch) {
    throw serviceError('当前不在有效分支上', 409);
  }
}

function parseBranchList(output = '', currentBranch = '', defaultBranch = 'main', cwd = '') {
  return String(output || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name = '', upstream = '', worktreePath = ''] = line.split('\t');
      const branch = name.trim();
      const checkedOutElsewhere =
        Boolean(worktreePath.trim()) &&
        branch !== currentBranch &&
        path.resolve(worktreePath.trim()) !== path.resolve(cwd || '.');
      return {
        name: branch,
        current: branch === currentBranch,
        default: branch === defaultBranch,
        upstream: upstream.trim() || null,
        checkedOutElsewhere,
        worktreePath: checkedOutElsewhere ? worktreePath.trim() : null
      };
    })
    .filter((branch) => branch.name)
    .sort((a, b) => {
      if (a.current !== b.current) {
        return a.current ? -1 : 1;
      }
      if (a.default !== b.default) {
        return a.default ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
}

function parseDefaultBranch(value = '') {
  const branch = String(value || '').trim().replace(/^origin\//, '');
  return branch || 'main';
}

function remoteCompareUrl(remoteUrl = '', baseBranch = 'main', branch = '') {
  const raw = String(remoteUrl || '').trim().replace(/\.git$/, '');
  const match =
    raw.match(/^git@github\.com:([^/]+)\/(.+)$/) ||
    raw.match(/^https:\/\/github\.com\/([^/]+)\/(.+)$/);
  if (!match || !branch) {
    return '';
  }
  const owner = encodeURIComponent(match[1]);
  const repo = encodeURIComponent(match[2]);
  return `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branch)}?expand=1`;
}

export function truncateGitOutput(value = '', maxChars = MAX_DIFF_CHARS) {
  const text = String(value || '');
  const limit = Math.max(1000, Number(maxChars) || MAX_DIFF_CHARS);
  if (text.length <= limit) {
    return {
      text,
      truncated: false,
      originalLength: text.length
    };
  }
  return {
    text: `${text.slice(0, limit)}\n\n[diff truncated: ${text.length - limit} characters hidden]`,
    truncated: true,
    originalLength: text.length
  };
}

export function createGitService({ getProject, runner = runGit } = {}) {
  if (typeof getProject !== 'function') {
    throw new Error('createGitService requires getProject');
  }

  async function projectCwd(projectId) {
    const project = getProject(projectId);
    if (!project?.path) {
      throw serviceError('Project not found', 404);
    }
    await runner(project.path, ['rev-parse', '--show-toplevel']);
    return project.path;
  }

  async function projectRoot(projectId) {
    const cwd = await projectCwd(projectId);
    const result = await runner(cwd, ['rev-parse', '--show-toplevel']);
    return result.stdout.trim() || cwd;
  }

  async function status(projectId) {
    const cwd = await projectCwd(projectId);
    const result = await runner(cwd, ['status', '--short', '--branch']);
    const parsed = parseGitStatusShort(result.stdout);
    return {
      ...parsed,
      defaultCommitMessage: defaultCommitMessage(parsed)
    };
  }

  async function createBranch(projectId, branchName) {
    const cwd = await projectCwd(projectId);
    const name = normalizeBranchName(branchName);
    await runner(cwd, ['switch', '-c', name]);
    return {
      branch: name,
      status: await status(projectId)
    };
  }

  async function branches(projectId) {
    const cwd = await projectCwd(projectId);
    const current = await status(projectId);
    let defaultBranch = 'main';
    try {
      const result = await runner(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short']);
      defaultBranch = parseDefaultBranch(result.stdout);
    } catch {
      defaultBranch = current.branch === 'master' ? 'master' : 'main';
    }
    const result = await runner(cwd, [
      'for-each-ref',
      'refs/heads',
      '--format=%(refname:short)\t%(upstream:short)\t%(worktreepath)'
    ]);
    return {
      current: current.branch || '',
      defaultBranch,
      limited: false,
      branches: parseBranchList(result.stdout, current.branch || '', defaultBranch, cwd),
      status: current
    };
  }

  async function checkout(projectId, branch) {
    const cwd = await projectCwd(projectId);
    const name = sanitizeExistingBranchName(branch);
    await runner(cwd, ['switch', name]);
    return {
      branch: name,
      status: await status(projectId)
    };
  }

  async function diff(projectId) {
    const cwd = await projectCwd(projectId);
    const summary = await runner(cwd, ['diff', 'HEAD', '--stat']);
    const patch = runner === runGit
      ? await runGitCapped(cwd, ['diff', 'HEAD', '--'], { timeoutMs: 30_000, maxChars: MAX_DIFF_CHARS })
      : await runner(cwd, ['diff', 'HEAD', '--']);
    const truncated = patch.truncated
      ? {
          text: `${patch.stdout}\n\n[diff truncated: ${Math.max(0, Number(patch.originalLength || 0) - patch.stdout.length)} bytes hidden]`,
          truncated: true,
          originalLength: patch.originalLength
        }
      : truncateGitOutput(patch.stdout);
    return {
      summary: summary.stdout.trim(),
      patch: truncated.text,
      truncated: truncated.truncated,
      originalLength: truncated.originalLength,
      status: await status(projectId)
    };
  }

  async function commit(projectId, message) {
    const cwd = await projectCwd(projectId);
    const before = await status(projectId);
    ensureMobileSafeGitAction(before);
    if (before.clean) {
      throw serviceError('没有可提交的改动', 409);
    }
    const commitMessage = sanitizeCommitMessage(message || before.defaultCommitMessage);
    await runner(cwd, ['add', '-A']);
    const result = await runner(cwd, ['commit', '-m', commitMessage], { timeoutMs: 60_000 });
    const hash = (await runner(cwd, ['rev-parse', '--short', 'HEAD'])).stdout.trim();
    return {
      message: commitMessage,
      hash,
      output: result.stdout.trim() || result.stderr.trim(),
      status: await status(projectId)
    };
  }

  async function push(projectId, { remote = 'origin', branch = null } = {}) {
    const cwd = await projectCwd(projectId);
    const current = await status(projectId);
    ensureMobileSafeGitAction(current);
    const targetBranch = String(branch || current.branch || '').trim();
    if (!targetBranch) {
      throw serviceError('当前不在有效分支上', 409);
    }
    const args = current.upstream
      ? ['push', remote]
      : ['push', '-u', remote, targetBranch];
    const result = await runner(cwd, args, { timeoutMs: 120_000 });
    return {
      remote,
      branch: targetBranch,
      output: result.stdout.trim() || result.stderr.trim(),
      status: await status(projectId)
    };
  }

  async function pull(projectId, { remote = null, branch = null } = {}) {
    const cwd = await projectCwd(projectId);
    const args = ['pull', '--ff-only'];
    if (remote && branch) {
      args.push(String(remote), String(branch));
    }
    const result = await runner(cwd, args, { timeoutMs: 120_000 });
    return {
      output: result.stdout.trim() || result.stderr.trim(),
      status: await status(projectId)
    };
  }

  async function worktree(projectId, { branchName, baseBranch = 'main' } = {}) {
    const cwd = await projectCwd(projectId);
    const root = await projectRoot(projectId);
    const branch = normalizeBranchName(branchName);
    const base = sanitizeExistingBranchName(baseBranch || 'main');
    const leaf = branch.split('/').filter(Boolean).pop() || 'worktree';
    const worktreePath = path.join(path.dirname(root), `${path.basename(root)}-${leaf}`);
    const result = await runner(cwd, ['worktree', 'add', '-b', branch, worktreePath, base], { timeoutMs: 120_000 });
    return {
      branch,
      baseBranch: base,
      worktreePath,
      output: result.stdout.trim() || result.stderr.trim(),
      branches: await branches(projectId)
    };
  }

  async function prDraft(projectId, { baseBranch = 'main' } = {}) {
    const cwd = await projectCwd(projectId);
    const current = await status(projectId);
    if (!current.branch) {
      throw serviceError('当前不在有效分支上', 409);
    }
    const base = sanitizeExistingBranchName(baseBranch || 'main');
    const [remote, log, diffSummary] = await Promise.all([
      runner(cwd, ['config', '--get', 'remote.origin.url']).catch(() => ({ stdout: '', stderr: '' })),
      runner(cwd, ['log', '--oneline', `${base}..HEAD`]).catch(() => ({ stdout: '', stderr: '' })),
      runner(cwd, ['diff', `${base}...HEAD`, '--stat']).catch(() => ({ stdout: '', stderr: '' }))
    ]);
    const title = current.defaultCommitMessage || `更新 ${current.branch}`;
    const changedFiles = current.files.map((file) => `- ${file.status} ${file.path}`).join('\n');
    const commits = log.stdout.trim() || '- 暂无本地提交差异';
    const body = [
      '## Summary',
      changedFiles || '- 工作区当前无未提交改动',
      '',
      '## Commits',
      commits,
      '',
      '## Diff Stat',
      diffSummary.stdout.trim() || '暂无 diff stat',
      '',
      '## Test Plan',
      '- [ ] node --test server/*.test.* shared/*.test.* client/src/*.test.*',
      '- [ ] npm run build'
    ].join('\n');
    return {
      title,
      body,
      baseBranch: base,
      branch: current.branch,
      compareUrl: remoteCompareUrl(remote.stdout, base, current.branch),
      needsPush: !current.upstream || current.ahead > 0,
      status: current
    };
  }

  async function sync(projectId) {
    const before = await status(projectId);
    ensureMobileSafeGitAction(before);
    const pulled = await pull(projectId);
    const afterPull = pulled.status;
    ensureMobileSafeGitAction(afterPull);
    let pushed = null;
    if (afterPull.ahead > 0) {
      pushed = await push(projectId);
    }
    return {
      pulled,
      pushed,
      output: [pulled.output, pushed?.output].filter(Boolean).join('\n\n'),
      status: pushed?.status || afterPull
    };
  }

  async function commitPush(projectId, message) {
    const committed = await commit(projectId, message);
    const pushed = await push(projectId);
    return {
      committed,
      pushed,
      message: committed.message,
      hash: committed.hash,
      output: [committed.output, pushed.output].filter(Boolean).join('\n\n'),
      status: pushed.status
    };
  }

  return { status, branches, createBranch, checkout, diff, commit, push, pull, sync, commitPush, worktree, prDraft };
}
