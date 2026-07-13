/**
 * 测试 file-manager-state.js：文件管理面板打开、路径导航与列表排序。
 * Keywords: file-manager, state, navigation, tests
 * Exports: 无导出 / 内含用例
 * Inward: file-manager-state.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialFileManagerState,
  fileManagerEntryOpenAction,
  fileManagerReducer,
  initialFileManagerState,
  rememberFileManagerView,
  sortFileManagerEntries
} from './file-manager-state.js';

test('fileManagerReducer opens at the requested path and closes without losing it', () => {
  const opened = fileManagerReducer(initialFileManagerState, {
    type: 'open',
    path: '/Users/example/Code'
  });

  assert.equal(opened.open, true);
  assert.equal(opened.path, '/Users/example/Code');

  const closed = fileManagerReducer(opened, { type: 'close' });
  assert.equal(closed.open, false);
  assert.equal(closed.path, '/Users/example/Code');
});

test('file manager restores open page and path after refresh', () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) || '',
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key)
  };

  rememberFileManagerView({ open: true, path: '/Users/example/Documents' }, storage);

  const restored = createInitialFileManagerState({ storage });
  assert.equal(restored.open, true);
  assert.equal(restored.path, '/Users/example/Documents');

  rememberFileManagerView({ open: false, path: '/Users/example/Documents' }, storage);
  assert.equal(createInitialFileManagerState({ storage }).open, false);
});

test('fileManagerReducer keeps server listing metadata together', () => {
  const next = fileManagerReducer(initialFileManagerState, {
    type: 'loaded',
    path: '/Users/example',
    parentPath: '/Users',
    entries: [{ name: 'notes', kind: 'directory' }]
  });

  assert.equal(next.loading, false);
  assert.equal(next.error, '');
  assert.equal(next.path, '/Users/example');
  assert.equal(next.parentPath, '/Users');
  assert.deepEqual(next.entries, [{ name: 'notes', kind: 'directory' }]);
});

test('sortFileManagerEntries keeps directories before files and sorts by name', () => {
  const entries = sortFileManagerEntries([
    { name: 'z.txt', kind: 'file' },
    { name: 'Archive', kind: 'directory' },
    { name: 'a.txt', kind: 'file' },
    { name: 'Code', kind: 'directory' }
  ]);

  assert.deepEqual(entries.map((entry) => entry.name), ['Archive', 'Code', 'a.txt', 'z.txt']);
});

test('fileManagerEntryOpenAction previews files inline only on desktop layouts', () => {
  const folder = { name: 'Code', kind: 'directory', path: '/Users/example/Code' };
  const file = { name: 'README.md', kind: 'file', path: '/Users/example/README.md' };

  assert.deepEqual(fileManagerEntryOpenAction(folder, { desktop: true }), {
    type: 'directory',
    path: '/Users/example/Code'
  });
  assert.deepEqual(fileManagerEntryOpenAction(file, { desktop: true }), {
    type: 'preview',
    path: '/Users/example/README.md'
  });
  assert.deepEqual(fileManagerEntryOpenAction(file, { desktop: false }), {
    type: 'navigate',
    path: '/Users/example/README.md'
  });
});
