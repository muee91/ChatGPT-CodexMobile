/**
 * 测试 scripts/apply-update.mjs 的自动 stash、拉取 tag、安装与构建命令顺序。
 *
 * Keywords: apply-update, stash, git, build, test
 *
 * Exports: 无导出 / 内含用例
 *
 * Inward: apply-update.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runApplyUpdate } from './apply-update.mjs';

test('runApplyUpdate stashes dirty worktree before checking out release tag', async () => {
  const commands = [];
  const states = [];
  await runApplyUpdate({
    rootDir: '/repo',
    tag: 'v2.0.2',
    now: () => new Date('2026-05-15T00:00:00Z'),
    writeProgress: async (state) => states.push(state),
    commandRunner: async (command, args) => {
      commands.push([command, ...args]);
      if (command === 'git' && args.join(' ') === 'status --porcelain') {
        return { stdout: ' M server/index.js\n', stderr: '', status: 0 };
      }
      if (command === 'git' && args.join(' ') === 'stash push -u -m CodexMobile auto-update v2.0.2 2026-05-15T00:00:00.000Z') {
        return { stdout: 'Saved working directory\n', stderr: '', status: 0 };
      }
      return { stdout: '', stderr: '', status: 0 };
    }
  });

  assert.deepEqual(commands, [
    ['git', 'status', '--porcelain'],
    ['git', 'stash', 'push', '-u', '-m', 'CodexMobile auto-update v2.0.2 2026-05-15T00:00:00.000Z'],
    ['git', 'fetch', '--tags', 'origin'],
    ['git', 'checkout', 'v2.0.2'],
    ['npm', 'install'],
    ['npm', 'run', 'build']
  ]);
  assert.equal(states.at(-1).state, 'success');
  assert.equal(states.at(-1).stashCreated, true);
});
