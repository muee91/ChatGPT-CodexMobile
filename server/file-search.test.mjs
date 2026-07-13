/**
 * 测试 server/file-search.js：git ls-files 搜索与忽略目录规则。
 *
 * Keywords: file-search, test, git
 *
 * Exports: 无导出，内含用例
 *
 * Inward: file-search.js
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileSearchInternals, searchProjectFiles } from './file-search.js';

test('file search ignores generated and dependency directories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-file-search-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  await fs.mkdir(path.join(root, '.codexmobile'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'App.jsx'), '');
  await fs.writeFile(path.join(root, '.git', 'App.jsx'), '');
  await fs.writeFile(path.join(root, 'node_modules', 'pkg', 'App.jsx'), '');
  await fs.writeFile(path.join(root, 'dist', 'App.jsx'), '');
  await fs.writeFile(path.join(root, '.codexmobile', 'App.jsx'), '');

  const results = await searchProjectFiles({ path: root }, 'app');
  assert.deepEqual(results.map((item) => item.relativePath), ['src/App.jsx']);
});

test('file search ignore helper covers required directories', () => {
  assert.equal(fileSearchInternals.isIgnoredRelativePath('.git/config'), true);
  assert.equal(fileSearchInternals.isIgnoredRelativePath('node_modules/pkg/index.js'), true);
  assert.equal(fileSearchInternals.isIgnoredRelativePath('dist/app.js'), true);
  assert.equal(fileSearchInternals.isIgnoredRelativePath('.codexmobile/state.json'), true);
  assert.equal(fileSearchInternals.isIgnoredRelativePath('src/App.jsx'), false);
});
