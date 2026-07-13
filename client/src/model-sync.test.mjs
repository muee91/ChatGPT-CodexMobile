/**
 * 测试 app/model-sync.js：Composer 模型与桌面状态同步推导。
 * Keywords: model-sync, composer, tests
 * Exports: 无导出 / 内含用例
 * Inward: app/model-sync.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  effectiveComposerSettingsSource,
  mergeModelSettingsIntoStatus,
  nextSyncedComposerSettings,
  shouldApplyModelSettings
} from './app/model-sync.js';

test('composer model follows desktop status changes while it is still synced', () => {
  const next = nextSyncedComposerSettings({
    currentModel: 'gpt-5.4',
    previousStatusModel: 'gpt-5.4',
    statusModel: 'gpt-5.2',
    currentReasoningEffort: 'high',
    previousStatusReasoningEffort: 'high',
    statusReasoningEffort: 'xhigh'
  });

  assert.deepEqual(next, {
    model: 'gpt-5.2',
    reasoningEffort: 'xhigh'
  });
});

test('composer model keeps an explicit mobile choice until desktop status catches up', () => {
  const next = nextSyncedComposerSettings({
    currentModel: 'gpt-5.3-codex',
    previousStatusModel: 'gpt-5.4',
    statusModel: 'gpt-5.4',
    currentReasoningEffort: 'high',
    previousStatusReasoningEffort: 'xhigh',
    statusReasoningEffort: 'xhigh'
  });

  assert.deepEqual(next, {
    model: 'gpt-5.3-codex',
    reasoningEffort: 'high'
  });
});

test('model settings broadcasts patch status without dropping other fields', () => {
  assert.deepEqual(
    mergeModelSettingsIntoStatus(
      { connected: true, model: 'gpt-5.4', reasoningEffort: 'medium', docs: { connected: false } },
      { model: 'gpt-5.5', modelShort: '5.5 中', reasoningEffort: 'high', provider: 'codex' }
    ),
    {
      connected: true,
      provider: 'codex',
      model: 'gpt-5.5',
      modelShort: '5.5 中',
      reasoningEffort: 'high',
      docs: { connected: false }
    }
  );
});

test('thread-scoped model settings only apply to the selected session', () => {
  assert.equal(
    shouldApplyModelSettings({ model: 'gpt-5.4', sessionId: 'thread-a' }, { id: 'thread-a' }),
    true
  );
  assert.equal(
    shouldApplyModelSettings({ model: 'gpt-5.4', sessionId: 'thread-a' }, { id: 'thread-b' }),
    false
  );
  assert.equal(
    shouldApplyModelSettings({ model: 'gpt-5.4' }, { id: 'thread-b' }),
    true
  );
});

test('effective composer settings follow the selected session without mutating global status meaning', () => {
  assert.deepEqual(
    effectiveComposerSettingsSource(
      { model: 'gpt-5.4', reasoningEffort: 'medium', provider: 'custom', modelShort: '5.4 中' },
      { id: 'thread-a', model: 'gpt-5.2', reasoningEffort: 'high', provider: 'openai' }
    ),
    {
      model: 'gpt-5.2',
      reasoningEffort: 'high',
      provider: 'openai',
      modelShort: '5.4 中'
    }
  );
});
