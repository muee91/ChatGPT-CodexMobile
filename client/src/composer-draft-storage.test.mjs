/**
 * 测试 composer-draft-storage.js：未发送输入在重载后仍能按会话恢复。
 * Keywords: composer, draft, storage, tests
 * Exports: 无导出 / 内含用例
 * Inward: composer-draft-storage.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPOSER_DRAFT_STORAGE_KEY,
  readStoredComposerDrafts,
  storedComposerDraftsFromState,
  writeStoredComposerDrafts
} from './composer-draft-storage.js';

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return values.get(key) || null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

test('composer drafts persist only unsent input and restore by session key', () => {
  const storage = memoryStorage();
  writeStoredComposerDrafts({
    'thread-1': { input: '正在编辑的消息', attachments: [{ name: 'private.png' }] },
    'thread-2': { input: '' }
  }, storage, 123);

  assert.deepEqual(readStoredComposerDrafts(storage), {
    'thread-1': { input: '正在编辑的消息', updatedAt: 123 }
  });
  assert.match(storage.getItem(COMPOSER_DRAFT_STORAGE_KEY), /正在编辑的消息/);
  assert.doesNotMatch(storage.getItem(COMPOSER_DRAFT_STORAGE_KEY), /private\.png/);
});

test('composer draft persistence caps old entries and malformed storage is ignored', () => {
  const manyDrafts = Object.fromEntries(
    Array.from({ length: 30 }, (_, index) => [`thread-${index}`, { input: `消息${index}`, updatedAt: index + 1 }])
  );
  const stored = storedComposerDraftsFromState(manyDrafts, 100);

  assert.equal(Object.keys(stored).length, 24);
  assert.equal(stored['thread-29'].input, '消息29');
  assert.equal(stored['thread-0'], undefined);
  assert.deepEqual(
    readStoredComposerDrafts(memoryStorage({ [COMPOSER_DRAFT_STORAGE_KEY]: '{invalid' })),
    {}
  );
});
