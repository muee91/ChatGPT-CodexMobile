/**
 * 测试 server/file-browser.js：本地目录浏览、常用入口与文件元数据。
 * Keywords: file-browser, directory, local-files, tests
 * Exports: 无导出 / 内含用例
 * Inward: file-browser.js
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileBrowserInternals, listLocalDirectory, localFileRoots } from './file-browser.js';

test('listLocalDirectory returns directories first with editable file metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-file-browser-'));
  await fs.mkdir(path.join(root, 'notes'));
  await fs.writeFile(path.join(root, 'a-readme.md'), '# Hello');
  await fs.writeFile(path.join(root, 'z-archive.zip'), 'zip');

  const result = await listLocalDirectory(root);

  assert.equal(result.path, root);
  assert.equal(result.parentPath, path.dirname(root));
  assert.deepEqual(
    result.entries.map((entry) => [entry.name, entry.kind, entry.editable]),
    [
      ['notes', 'directory', false],
      ['a-readme.md', 'file', true],
      ['z-archive.zip', 'file', false]
    ]
  );
});

test('listLocalDirectory defaults to home and rejects non-directory paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-file-browser-'));
  const filePath = path.join(root, 'plain.txt');
  await fs.writeFile(filePath, 'plain');

  assert.equal((await listLocalDirectory('')).path, os.homedir());
  await assert.rejects(() => listLocalDirectory(filePath), /Path is not a directory/);
});

test('localFileRoots exposes useful unique absolute locations', () => {
  const roots = localFileRoots({ cwd: '/tmp/project', homedir: '/Users/example' });
  assert.equal(roots[0].id, 'home');
  assert.equal(roots[0].path, '/Users/example');
  assert.ok(roots.some((root) => root.id === 'cwd' && root.path === '/tmp/project'));
  assert.equal(new Set(roots.map((root) => root.path)).size, roots.length);
});

test('file browser path helpers expand user-home shorthand', () => {
  assert.equal(
    fileBrowserInternals.resolveBrowserPath('~/Desktop', { homedir: '/Users/example' }),
    path.join('/Users/example', 'Desktop')
  );
});
