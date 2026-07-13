/**
 * 检查 GitHub Release 并触发 CodexMobile 本地仓库自更新流程。
 *
 * Keywords: update, github-release, git, version, restart
 *
 * Exports:
 * - compareVersions — 比较 v/semver 风格版本号。
 * - parseGitHubRepoFromRemote — 从 origin remote 提取 owner/repo。
 * - createUpdateService — 创建 release 检查、安装触发与进度读取服务。
 *
 * Inward（本模块依赖/组装的关键符号）: child_process、package.json、GitHub releases/latest、scripts/apply-update.mjs。
 *
 * Outward（谁在用/调用场景）: update-routes.js、server/index.js。
 *
 * 不负责: 前端展示与 release 发布本身。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_STATUS_FILE = path.join('.codexmobile', 'state', 'update-status.json');
const GITHUB_LATEST_RELEASE = 'https://api.github.com/repos/{repo}/releases/latest';
const TAG_PATTERN = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function stripVersionPrefix(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function parseVersionParts(value) {
  const normalized = stripVersionPrefix(value);
  const [main, suffix = ''] = normalized.split(/[-+]/, 2);
  const parts = main.split('.').map((part) => Number(part));
  return {
    parts: [parts[0] || 0, parts[1] || 0, parts[2] || 0],
    prerelease: normalized.includes('-') ? suffix : ''
  };
}

export function compareVersions(left, right) {
  const a = parseVersionParts(left);
  const b = parseVersionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] > b.parts[index]) {
      return 1;
    }
    if (a.parts[index] < b.parts[index]) {
      return -1;
    }
  }
  if (a.prerelease && !b.prerelease) {
    return -1;
  }
  if (!a.prerelease && b.prerelease) {
    return 1;
  }
  return a.prerelease.localeCompare(b.prerelease);
}

export function parseGitHubRepoFromRemote(remote) {
  const value = String(remote || '').trim().replace(/\.git$/, '');
  const httpsMatch = value.match(/^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)$/i);
  if (httpsMatch) {
    return httpsMatch[1];
  }
  const sshMatch = value.match(/^git@github\.com:([^/\s]+\/[^/\s]+)$/i);
  return sshMatch ? sshMatch[1] : '';
}

async function defaultCommandRunner(command, args = [], { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (status) => {
      if (status !== 0) {
        const error = new Error((stderr || stdout || `${command} ${args.join(' ')} failed`).trim());
        error.status = status;
        reject(error);
        return;
      }
      resolve({ stdout, stderr, status });
    });
  });
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

function httpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeRelease(release = {}) {
  const tag = String(release.tag_name || release.tagName || '').trim();
  return {
    tag,
    version: stripVersionPrefix(tag),
    name: release.name || tag,
    releaseUrl: release.html_url || release.releaseUrl || '',
    publishedAt: release.published_at || release.publishedAt || '',
    notes: release.body || release.notes || '',
    draft: Boolean(release.draft),
    prerelease: Boolean(release.prerelease)
  };
}

export function createUpdateService({
  rootDir,
  fetchImpl = globalThis.fetch,
  commandRunner = defaultCommandRunner,
  startUpdateProcess = null,
  statusPath = path.join(rootDir, DEFAULT_STATUS_FILE),
  fetchTimeoutMs = 12_000,
  now = () => new Date(),
  restartServer = () => {
    const timer = setTimeout(() => process.exit(0), 800);
    timer.unref?.();
  },
  log = console
} = {}) {
  if (!rootDir) {
    throw new Error('createUpdateService requires rootDir');
  }
  let updateInProgress = false;

  async function run(command, args = []) {
    return commandRunner(command, args, { cwd: rootDir });
  }

  async function writeProgress(progress) {
    const payload = {
      updatedAt: now().toISOString(),
      ...progress
    };
    await fs.mkdir(path.dirname(statusPath), { recursive: true });
    await fs.writeFile(statusPath, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
  }

  async function readProgress() {
    return await readJson(statusPath, { state: 'idle' });
  }

  async function packageVersion() {
    const packageJson = await readJson(path.join(rootDir, 'package.json'), {});
    return String(packageJson.version || '0.0.0').trim();
  }

  async function latestRelease(repo) {
    if (typeof fetchImpl !== 'function') {
      throw httpError('Fetch is not available in this Node runtime', 500);
    }
    const response = await fetchImpl(GITHUB_LATEST_RELEASE.replace('{repo}', repo), {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'CodexMobile update checker'
      },
      signal: globalThis.AbortSignal?.timeout?.(fetchTimeoutMs)
    });
    if (!response?.ok) {
      throw httpError(`GitHub release check failed: ${response?.status || 'unknown'}`, 502);
    }
    return normalizeRelease(await response.json());
  }

  async function checkForUpdates() {
    const currentVersion = await packageVersion();
    const remote = (await run('git', ['remote', 'get-url', 'origin'])).stdout.trim();
    const repo = parseGitHubRepoFromRemote(remote);
    if (!repo) {
      throw httpError('Origin remote is not a GitHub repository', 400);
    }
    const [dirtyResult, commitResult, release] = await Promise.all([
      run('git', ['status', '--porcelain']),
      run('git', ['rev-parse', '--short', 'HEAD']).catch(() => ({ stdout: '' })),
      latestRelease(repo)
    ]);
    if (!release.tag || !TAG_PATTERN.test(release.tag)) {
      throw httpError('Latest GitHub release tag is not installable', 400);
    }
    const updateAvailable = compareVersions(currentVersion, release.version) < 0;
    const dirty = Boolean(dirtyResult.stdout.trim());
    return {
      checkedAt: now().toISOString(),
      repo,
      currentVersion,
      currentCommit: commitResult.stdout.trim(),
      latestVersion: release.version,
      latestTag: release.tag,
      releaseName: release.name,
      releaseUrl: release.releaseUrl,
      publishedAt: release.publishedAt,
      notes: release.notes,
      updateAvailable,
      dirty,
      stashRequired: dirty
    };
  }

  async function defaultStartUpdateProcess({ tag }) {
    const scriptPath = path.join(rootDir, 'scripts', 'apply-update.mjs');
    const child = spawn(process.execPath, [scriptPath, '--tag', tag, '--status-path', statusPath], {
      cwd: rootDir,
      env: process.env,
      stdio: 'ignore'
    });
    child.on('close', async (code) => {
      updateInProgress = false;
      if (code === 0) {
        await writeProgress({ state: 'restarting', tag, message: '更新完成，正在重启服务。' }).catch(() => {});
        restartServer();
        return;
      }
      await writeProgress({ state: 'failed', tag, error: `更新脚本退出码 ${code}` }).catch(() => {});
    });
    child.on('error', async (error) => {
      updateInProgress = false;
      await writeProgress({ state: 'failed', tag, error: error.message }).catch(() => {});
      log.warn?.('[update] Failed to start update process:', error.message);
    });
    return { pid: child.pid || null };
  }

  async function applyUpdate({ tag } = {}) {
    const requestedTag = String(tag || '').trim();
    if (updateInProgress) {
      throw httpError('Update already in progress', 409);
    }
    const status = await checkForUpdates();
    if (requestedTag !== status.latestTag) {
      throw httpError('Only the latest GitHub release tag can be installed', 400);
    }
    if (!status.updateAvailable) {
      throw httpError('CodexMobile is already on the latest release', 400);
    }
    updateInProgress = true;
    await writeProgress({
      state: 'queued',
      tag: requestedTag,
      latestVersion: status.latestVersion,
      stashRequired: status.stashRequired,
      message: '更新任务已创建。'
    });
    try {
      const starter = startUpdateProcess || defaultStartUpdateProcess;
      const processInfo = await starter({
        tag: requestedTag,
        rootDir,
        statusPath,
        latestVersion: status.latestVersion
      });
      return { accepted: true, tag: requestedTag, latestVersion: status.latestVersion, ...processInfo };
    } catch (error) {
      updateInProgress = false;
      await writeProgress({ state: 'failed', tag: requestedTag, error: error.message });
      throw error;
    }
  }

  return {
    checkForUpdates,
    applyUpdate,
    readProgress,
    writeProgress
  };
}
