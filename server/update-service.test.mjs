/**
 * 测试 server/update-service.js 的 release 检查、版本比较与更新触发约束。
 *
 * Keywords: update-service, release, semver, test
 *
 * Exports: 无导出 / 内含用例
 *
 * Inward: update-service.js
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  compareVersions,
  createUpdateService,
  parseGitHubRepoFromRemote
} from './update-service.js';

async function makeRoot(version = '2.0.1') {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-update-'));
  await fs.mkdir(path.join(rootDir, '.codexmobile', 'state'), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, 'package.json'),
    JSON.stringify({ name: 'codexmobile', version }, null, 2),
    'utf8'
  );
  return rootDir;
}

function commandRunnerFor(overrides = {}) {
  const calls = [];
  const runner = async (command, args = []) => {
    calls.push([command, ...args]);
    const key = [command, ...args].join(' ');
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      return { stdout: overrides[key], stderr: '', status: 0 };
    }
    if (command === 'git' && args.join(' ') === 'remote get-url origin') {
      return { stdout: 'https://github.com/flyyangX/CodexMobile.git\n', stderr: '', status: 0 };
    }
    if (command === 'git' && args.join(' ') === 'status --porcelain') {
      return { stdout: '', stderr: '', status: 0 };
    }
    if (command === 'git' && args.join(' ') === 'rev-parse --short HEAD') {
      return { stdout: 'abc123\n', stderr: '', status: 0 };
    }
    return { stdout: '', stderr: '', status: 0 };
  };
  runner.calls = calls;
  return runner;
}

function releaseFetch(tagName = 'v2.0.2') {
  return async (url) => {
    assert.equal(url, 'https://api.github.com/repos/flyyangX/CodexMobile/releases/latest');
    return {
      ok: true,
      async json() {
        return {
          tag_name: tagName,
          name: `CodexMobile ${tagName}`,
          html_url: `https://github.com/flyyangX/CodexMobile/releases/tag/${tagName}`,
          published_at: '2026-05-15T00:00:00Z',
          body: 'Release notes'
        };
      }
    };
  };
}

test('compareVersions orders release versions with optional v prefix', () => {
  assert.equal(compareVersions('2.0.10', 'v2.0.2'), 1);
  assert.equal(compareVersions('v2.0.1', '2.0.1'), 0);
  assert.equal(compareVersions('2.0.1', 'v2.0.2'), -1);
});

test('parseGitHubRepoFromRemote supports https and ssh remotes', () => {
  assert.equal(parseGitHubRepoFromRemote('https://github.com/flyyangX/CodexMobile.git'), 'flyyangX/CodexMobile');
  assert.equal(parseGitHubRepoFromRemote('git@github.com:flyyangX/CodexMobile.git'), 'flyyangX/CodexMobile');
});

test('checkForUpdates reports latest GitHub release and dirty state', async () => {
  const rootDir = await makeRoot('2.0.1');
  const service = createUpdateService({
    rootDir,
    fetchImpl: releaseFetch('v2.0.2'),
    commandRunner: commandRunnerFor({
      'git status --porcelain': ' M client/src/App.jsx\n'
    })
  });

  const status = await service.checkForUpdates();

  assert.equal(status.currentVersion, '2.0.1');
  assert.equal(status.latestVersion, '2.0.2');
  assert.equal(status.latestTag, 'v2.0.2');
  assert.equal(status.updateAvailable, true);
  assert.equal(status.dirty, true);
  assert.equal(status.stashRequired, true);
  assert.equal(status.releaseUrl, 'https://github.com/flyyangX/CodexMobile/releases/tag/v2.0.2');
});

test('applyUpdate only accepts the current latest release tag and starts one update', async () => {
  const rootDir = await makeRoot('2.0.1');
  const starts = [];
  const service = createUpdateService({
    rootDir,
    fetchImpl: releaseFetch('v2.0.2'),
    commandRunner: commandRunnerFor(),
    startUpdateProcess: async (request) => {
      starts.push(request);
      return { pid: 12345 };
    }
  });

  await assert.rejects(
    service.applyUpdate({ tag: 'v9.9.9' }),
    /Only the latest GitHub release tag can be installed/
  );

  const result = await service.applyUpdate({ tag: 'v2.0.2' });
  assert.equal(result.accepted, true);
  assert.equal(result.tag, 'v2.0.2');
  assert.equal(starts.length, 1);
  assert.equal(starts[0].tag, 'v2.0.2');

  await assert.rejects(
    service.applyUpdate({ tag: 'v2.0.2' }),
    /Update already in progress/
  );
});
