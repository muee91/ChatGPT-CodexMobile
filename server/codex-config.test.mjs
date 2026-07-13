/**
 * 测试 server/codex-config.js：隔离 CODEX_HOME 下配置读取行为。
 *
 * Keywords: codex-config, test, toml
 *
 * Exports: 无导出，内含用例
 *
 * Inward: codex-config.js
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function importCodexConfigWithHome(codexHome) {
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  const moduleUrl = new URL(`./codex-config.js?test=${Date.now()}-${Math.random()}`, import.meta.url);
  const module = await import(moduleUrl.href);
  if (previousHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = previousHome;
  }
  return module;
}

test('registerProjectlessThread preserves concurrent registrations in global state', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-config-test-'));
  const codexHome = path.join(tempRoot, '.codex');
  const workspaceRoot = path.join(tempRoot, 'projectless');
  const realDateNow = Date.now;
  Date.now = () => 1778269362647;
  try {
    const {
      CODEX_GLOBAL_STATE_PATH,
      registerProjectlessThread,
      readCodexWorkspaceState
    } = await importCodexConfigWithHome(codexHome);

    await fs.mkdir(codexHome, { recursive: true });
    await fs.writeFile(
      CODEX_GLOBAL_STATE_PATH,
      JSON.stringify({
        'projectless-thread-ids': ['existing-thread'],
        'thread-workspace-root-hints': {
          'existing-thread': workspaceRoot
        }
      }),
      'utf8'
    );

    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        registerProjectlessThread(`thread-${index}`, workspaceRoot)
      )
    );

    const workspaceState = await readCodexWorkspaceState();
    assert.deepEqual(
      workspaceState.projectlessThreadIds.toSorted(),
      ['existing-thread', ...Array.from({ length: 10 }, (_, index) => `thread-${index}`)].toSorted()
    );
    for (let index = 0; index < 10; index += 1) {
      assert.equal(workspaceState.threadWorkspaceRootHints[`thread-${index}`], workspaceRoot);
    }
  } finally {
    Date.now = realDateNow;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
