/**
 * 测试 FileManagerPanel 桌面布局源码与样式约束：左侧承担浏览控件，右侧只保留文件预览。
 * Keywords: file-manager, layout, desktop, tests
 * Exports: 无导出 / 内含用例
 * Inward: FileManagerPanel.jsx、panels-files.css
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const componentSource = readFileSync(new URL('./panels/FileManagerPanel.jsx', import.meta.url), 'utf8');
const previewSource = readFileSync(new URL('./app/FilePreviewApp.jsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('./styles/panels-files.css', import.meta.url), 'utf8');
const themeSource = readFileSync(new URL('./styles/theme.css', import.meta.url), 'utf8');

test('desktop file manager keeps navigation controls in the left sidebar', () => {
  assert.match(componentSource, /className="file-manager-shell"/);
  assert.match(componentSource, /className="file-manager-sidebar"/);
  assert.match(componentSource, /className="file-manager-sidebar-actions"/);
  assert.match(componentSource, /className="file-manager-root-menu"/);
  assert.doesNotMatch(componentSource, /className="file-manager-roots"/);
});

test('file manager avoids duplicate close and empty-preview helper copy', () => {
  const closeLabels = componentSource.match(/aria-label="关闭文件管理"/g) || [];

  assert.equal(closeLabels.length, 1);
  assert.doesNotMatch(componentSource, /右侧会作为完整桌面预览区显示当前文件/);
});

test('file manager exposes a guarded delete action for selected files', () => {
  assert.match(componentSource, /aria-label="删除文件"/);
  assert.match(componentSource, /window\.confirm/);
  assert.match(componentSource, /method:\s*'DELETE'/);
});

test('desktop file manager preview takes the full right side without a nested file header', () => {
  assert.match(cssSource, /\.file-manager-shell\s*{/);
  assert.match(cssSource, /grid-template-columns:\s*minmax\(300px,\s*400px\)\s+minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(cssSource, /\.file-manager-roots[\s\S]*?overflow-x:\s*auto/);
  assert.doesNotMatch(componentSource, /className="file-manager-preview-head"/);
});

test('embedded preview disables the tablet-sized root clamp inside the iframe', () => {
  assert.match(previewSource, /is-file-preview-embedded/);
  assert.match(themeSource, /html\.is-file-preview-embedded #root[\s\S]*?width:\s*100vw/);
  assert.match(themeSource, /html\.is-file-preview-embedded body[\s\S]*?display:\s*block/);
});

test('file preview toolbar keeps edit instead of a duplicated raw tab', () => {
  assert.doesNotMatch(previewSource, /<span>原文<\/span>/);
  assert.match(previewSource, /<span>编辑<\/span>/);
});
