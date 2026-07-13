/**
 * 执行 CodexMobile release 更新：必要时 stash，本地切换 tag，安装依赖并构建前端。
 *
 * Keywords: update, git-stash, release-tag, npm-install, build
 *
 * Exports:
 * - runApplyUpdate — 可注入 commandRunner 的更新执行函数。
 *
 * Inward（本模块依赖/组装的关键符号）: git、npm、update-status.json。
 *
 * Outward（谁在用/调用场景）: server/update-service.js 后台子进程。
 *
 * 不负责: GitHub release 检查与服务端重启。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const DEFAULT_STATUS_PATH = path.join(root, '.codexmobile', 'state', 'update-status.json');
const TAG_PATTERN = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

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

async function writeProgressFile(statusPath, progress) {
  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  await fs.writeFile(statusPath, JSON.stringify(progress, null, 2), 'utf8');
}

function stepProgress({ state, tag, message, extra = {}, now }) {
  return {
    state,
    tag,
    message,
    updatedAt: now().toISOString(),
    ...extra
  };
}

export async function runApplyUpdate({
  rootDir = root,
  tag,
  statusPath = DEFAULT_STATUS_PATH,
  commandRunner = defaultCommandRunner,
  writeProgress = (progress) => writeProgressFile(statusPath, progress),
  now = () => new Date()
} = {}) {
  const releaseTag = String(tag || '').trim();
  if (!TAG_PATTERN.test(releaseTag)) {
    throw new Error('Invalid release tag');
  }
  const run = async (command, args) => commandRunner(command, args, { cwd: rootDir });

  await writeProgress(stepProgress({ state: 'checking', tag: releaseTag, message: '正在检查本地工作区。', now }));
  const status = await run('git', ['status', '--porcelain']);
  const dirty = Boolean(status.stdout.trim());
  let stashCreated = false;
  let stashMessage = '';

  if (dirty) {
    stashMessage = `CodexMobile auto-update ${releaseTag} ${now().toISOString()}`;
    await writeProgress(stepProgress({
      state: 'stashing',
      tag: releaseTag,
      message: '检测到本地改动，正在自动 stash。',
      extra: { stashMessage },
      now
    }));
    await run('git', ['stash', 'push', '-u', '-m', stashMessage]);
    stashCreated = true;
  }

  await writeProgress(stepProgress({ state: 'fetching', tag: releaseTag, message: '正在拉取 GitHub release tag。', now }));
  await run('git', ['fetch', '--tags', 'origin']);

  await writeProgress(stepProgress({ state: 'checking-out', tag: releaseTag, message: '正在切换到 release tag。', now }));
  await run('git', ['checkout', releaseTag]);

  await writeProgress(stepProgress({ state: 'installing', tag: releaseTag, message: '正在安装依赖。', now }));
  await run('npm', ['install']);

  await writeProgress(stepProgress({ state: 'building', tag: releaseTag, message: '正在构建前端资源。', now }));
  await run('npm', ['run', 'build']);

  await writeProgress(stepProgress({
    state: 'success',
    tag: releaseTag,
    message: '更新完成。',
    extra: { stashCreated, stashMessage },
    now
  }));
  return { success: true, tag: releaseTag, stashCreated, stashMessage };
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  const tag = argValue('--tag');
  const statusPath = argValue('--status-path') || DEFAULT_STATUS_PATH;
  runApplyUpdate({ tag, statusPath }).catch(async (error) => {
    await writeProgressFile(statusPath, {
      state: 'failed',
      tag,
      error: error.message || '更新失败',
      updatedAt: new Date().toISOString()
    }).catch(() => {});
    console.error('[update] apply failed:', error);
    process.exitCode = 1;
  });
}
