/**
 * 验证 paste-files：剪贴板 files/items 合并与去重行为。
 *
 * Keywords: paste-files, clipboard, tests
 *
 * Exports: 无导出 / 内含用例
 *
 * Inward: paste-files.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { filesFromClipboardData } from './paste-files.js';

test('filesFromClipboardData returns files from clipboard files list', () => {
  const image = { name: 'screen.png', size: 123, type: 'image/png' };
  const pdf = { name: 'brief.pdf', size: 456, type: 'application/pdf' };

  assert.deepEqual(
    filesFromClipboardData({
      files: [image, pdf],
      items: []
    }),
    [image, pdf]
  );
});

test('filesFromClipboardData falls back to file items and skips non-files', () => {
  const image = { name: 'paste.png', size: 123, type: 'image/png' };

  assert.deepEqual(
    filesFromClipboardData({
      files: [],
      items: [
        { kind: 'string', getAsFile: () => null },
        { kind: 'file', getAsFile: () => image },
        { kind: 'file', getAsFile: () => null }
      ]
    }),
    [image]
  );
});

test('filesFromClipboardData dedupes files exposed in both lists', () => {
  const image = { name: 'paste.png', size: 123, type: 'image/png', lastModified: 1 };

  assert.deepEqual(
    filesFromClipboardData({
      files: [image],
      items: [{ kind: 'file', getAsFile: () => image }]
    }),
    [image]
  );
});

test('filesFromClipboardData dedupes pasted screenshots with different timestamps', () => {
  const fromFiles = { name: 'paste.png', size: 123, type: 'image/png', lastModified: 1 };
  const fromItems = { name: 'paste.png', size: 123, type: 'image/png', lastModified: 2 };

  assert.deepEqual(
    filesFromClipboardData({
      files: [fromFiles],
      items: [{ kind: 'file', getAsFile: () => fromItems }]
    }),
    [fromFiles]
  );
});
