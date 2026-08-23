/**
 * 输入草稿本机持久化：在 WebView 重载或 Android 回收前保存当前会话的未发送文本。
 *
 * Keywords: composer, draft, storage, android
 *
 * Exports:
 * - readStoredComposerDrafts / writeStoredComposerDrafts — 草稿序列化与恢复。
 *
 * Inward: localStorage。
 *
 * Outward: App.jsx。
 *
 * 不负责: 附件、技能、权限模式等临时 UI 状态。
 */

export const COMPOSER_DRAFT_STORAGE_KEY = 'codexmobile.composerDrafts.v1';
const MAX_DRAFTS = 24;
const MAX_DRAFT_CHARACTERS = 12_000;

function storageFor(storage = globalThis.localStorage) {
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
    ? storage
    : null;
}

function validKey(value) {
  return String(value || '').trim().slice(0, 256);
}

export function readStoredComposerDrafts(storage = globalThis.localStorage) {
  const target = storageFor(storage);
  if (!target) {
    return {};
  }
  try {
    const parsed = JSON.parse(target.getItem(COMPOSER_DRAFT_STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [
          validKey(key),
          {
            input: typeof value?.input === 'string'
              ? value.input.slice(0, MAX_DRAFT_CHARACTERS)
              : '',
            updatedAt: Number(value?.updatedAt) || 0
          }
        ])
        .filter(([key, value]) => key && value.input)
    );
  } catch {
    return {};
  }
}

export function storedComposerDraftsFromState(draftsByKey = {}, now = Date.now()) {
  const entries = Object.entries(draftsByKey)
    .map(([key, draft]) => ({
      key: validKey(key),
      input: typeof draft?.input === 'string' ? draft.input.slice(0, MAX_DRAFT_CHARACTERS) : '',
      updatedAt: Number(draft?.updatedAt) || now
    }))
    .filter((draft) => draft.key && draft.input);
  entries.sort((left, right) => right.updatedAt - left.updatedAt);
  return Object.fromEntries(entries.slice(0, MAX_DRAFTS).map((draft) => [
    draft.key,
    { input: draft.input, updatedAt: draft.updatedAt }
  ]));
}

export function writeStoredComposerDrafts(draftsByKey = {}, storage = globalThis.localStorage, now = Date.now()) {
  const target = storageFor(storage);
  if (!target) {
    return;
  }
  try {
    target.setItem(
      COMPOSER_DRAFT_STORAGE_KEY,
      JSON.stringify(storedComposerDraftsFromState(draftsByKey, now))
    );
  } catch {
    // A full or unavailable browser storage must not interrupt composing.
  }
}
