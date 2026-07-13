/**
 * 测试 server/sync：旧 payload 归一化为 SyncEvent 后，runtime 与 session 快照如何投影。
 *
 * Keywords: sync-store, sync-event, runtime
 *
 * Exports: 无导出 / 内含用例。
 *
 * Inward: server/sync/sync-events.js, server/sync/sync-store.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLegacyPayloadToSyncEvents } from './sync-events.js';
import { createSyncStore } from './sync-store.js';

test('desktop IPC running and completed update one runtime without chat activity semantics', () => {
  const store = createSyncStore();
  const [running] = normalizeLegacyPayloadToSyncEvents({
    type: 'status-update',
    source: 'desktop-ipc',
    kind: 'turn',
    status: 'running',
    sessionId: 'session-1',
    turnId: 'turn-1',
    label: '已交给桌面端处理'
  });

  assert.equal(running.eventType, 'turn.running');
  assert.equal(running.suppressedInChat, true);
  store.applyEvent(running);
  assert.equal(store.snapshot().runtimeById['session-1'].source, 'desktop-ipc');
  assert.equal(store.snapshot().runtimeById['turn-1'].status, 'running');

  const [completed] = normalizeLegacyPayloadToSyncEvents({
    type: 'desktop-thread-updated',
    source: 'desktop-ipc',
    status: 'completed',
    sessionId: 'session-1',
    turnId: 'turn-1'
  });
  store.applyEvent(completed);
  assert.equal(store.snapshot().runtimeById['session-1'], undefined);
  assert.equal(store.snapshot().runtimeById['turn-1'], undefined);
  assert.equal(store.snapshot().terminalById['session-1'].status, 'completed');
});

test('desktop IPC terminal event clears client turn keys for the same session', () => {
  const store = createSyncStore();
  const [running] = normalizeLegacyPayloadToSyncEvents({
    type: 'status-update',
    source: 'desktop-ipc',
    kind: 'turn',
    status: 'running',
    sessionId: 'session-1',
    turnId: 'client-turn-1',
    label: '已交给桌面端处理'
  });
  store.applyEvent(running);
  assert.equal(store.snapshot().runtimeById['client-turn-1'].status, 'running');

  const [completed] = normalizeLegacyPayloadToSyncEvents({
    type: 'desktop-thread-updated',
    source: 'desktop-ipc',
    status: 'completed',
    sessionId: 'session-1'
  });
  store.applyEvent(completed);

  assert.equal(store.snapshot().runtimeById['session-1'], undefined);
  assert.equal(store.snapshot().runtimeById['client-turn-1'], undefined);
  assert.equal(store.snapshot().terminalById['client-turn-1'].status, 'completed');
});

test('headless and desktop running events share the same runtime projection shape', () => {
  const store = createSyncStore();
  for (const payload of [
    { type: 'status-update', source: 'desktop-ipc', status: 'running', sessionId: 'desktop-session', turnId: 'desktop-turn' },
    { type: 'status-update', source: 'headless-local', status: 'running', sessionId: 'headless-session', turnId: 'headless-turn' }
  ]) {
    for (const event of normalizeLegacyPayloadToSyncEvents(payload)) {
      store.applyEvent(event);
    }
  }
  const snapshot = store.snapshot();
  assert.deepEqual(Object.keys(snapshot.runtimeById['desktop-session']).sort(), Object.keys(snapshot.runtimeById['headless-session']).sort());
  assert.equal(snapshot.runtimeById['desktop-session'].source, 'desktop-ipc');
  assert.equal(snapshot.runtimeById['headless-session'].source, 'headless-local');
});

test('assistant plan updates preserve plan implementation metadata', () => {
  const [event] = normalizeLegacyPayloadToSyncEvents({
    type: 'assistant-update',
    sessionId: 'session-1',
    turnId: 'turn-1',
    messageId: 'implement-plan:app-turn-1',
    content: '<proposed_plan>\n# 修复计划\n</proposed_plan>',
    planImplementation: {
      requestId: 'implement-plan:app-turn-1',
      turnId: 'app-turn-1',
      planContent: '# 修复计划',
      completed: false
    }
  });

  assert.equal(event.eventType, 'message.assistant.completed');
  assert.deepEqual(event.message.planImplementation, {
    requestId: 'implement-plan:app-turn-1',
    turnId: 'app-turn-1',
    planContent: '# 修复计划',
    completed: false
  });
});

test('interaction request payloads become non-runtime sync events with interaction details', () => {
  const [requested] = normalizeLegacyPayloadToSyncEvents({
    type: 'interaction-request',
    projectId: 'project-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    interaction: {
      id: 'interaction-1',
      kind: 'user_input',
      title: '检查方式',
      questions: [{ id: 'check_method', question: '怎么检查？', options: [] }]
    }
  });

  assert.equal(requested.eventType, 'interaction.requested');
  assert.equal(requested.interaction.id, 'interaction-1');
  assert.equal(requested.interaction.questions[0].id, 'check_method');

  const store = createSyncStore();
  store.applyEvent(requested);
  assert.deepEqual(store.snapshot().runtimeById, {});

  const [resolved] = normalizeLegacyPayloadToSyncEvents({
    type: 'interaction-resolved',
    sessionId: 'session-1',
    turnId: 'turn-1',
    interactionId: 'interaction-1',
    status: 'completed'
  });
  assert.equal(resolved.eventType, 'interaction.resolved');
  assert.equal(resolved.interactionId, 'interaction-1');
});

test('sessions synced and rename events update sidebar projection data', () => {
  const store = createSyncStore();
  const [synced] = normalizeLegacyPayloadToSyncEvents({
    type: 'sync-complete',
    syncedAt: '2026-05-13T01:00:00.000Z',
    projects: [
      {
        id: 'project-1',
        name: '普通对话',
        sessions: [{ id: 'session-1', title: '旧标题' }]
      }
    ]
  });
  store.applyEvent(synced);
  const [renamed] = normalizeLegacyPayloadToSyncEvents({
    type: 'session-renamed',
    projectId: 'project-1',
    sessionId: 'session-1',
    title: '新标题'
  });
  store.applyEvent(renamed);
  assert.equal(store.snapshot().projects[0].sessions[0].title, '新标题');
});

test('desktop thread updates without an explicit runtime status do not create running state', () => {
  const store = createSyncStore();
  const [event] = normalizeLegacyPayloadToSyncEvents({
    type: 'desktop-thread-updated',
    source: 'desktop-ipc',
    sessionId: 'session-1'
  });
  assert.equal(event.eventType, 'thread.updated');
  store.applyEvent(event);
  assert.deepEqual(store.snapshot().runtimeById, {});
});

test('model updates keep thread scope in sync state', () => {
  const store = createSyncStore();
  const [event] = normalizeLegacyPayloadToSyncEvents({
    type: 'model-settings-updated',
    source: 'desktop-thread',
    sessionId: 'session-1',
    model: 'gpt-5.4',
    reasoningEffort: 'medium',
    provider: 'openai'
  });

  store.applyEvent(event);

  assert.deepEqual(store.snapshot().modelSettings, {
    provider: 'openai',
    model: 'gpt-5.4',
    modelShort: null,
    reasoningEffort: 'medium',
    sessionId: 'session-1',
    updatedAt: event.timestamp,
    source: 'desktop-thread',
    desktopSync: null
  });
});
