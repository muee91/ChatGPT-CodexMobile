/**
 * 测试 server/chat-service.js：发送消息、队列与依赖注入路径。
 *
 * Keywords: chat-service, test, integration
 *
 * Exports: 无导出，内含用例
 *
 * Inward: chat-service.js
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatService } from './chat-service.js';

function desktopOwnerUnavailableError() {
  const error = new Error('桌面端 Codex 已连接，但当前线程没有可接管的桌面窗口。');
  error.statusCode = 409;
  error.code = 'CODEXMOBILE_DESKTOP_THREAD_OWNER_UNAVAILABLE';
  return error;
}

async function rejectDesktopFollowerTurn() {
  throw desktopOwnerUnavailableError();
}

function desktopTimeoutError(method = 'thread-follower-start-turn') {
  const error = new Error(`桌面端 Codex IPC 请求超时: ${method}`);
  error.code = 'CODEXMOBILE_DESKTOP_IPC_TIMEOUT';
  return error;
}

function makeChatService(overrides = {}) {
  const broadcasts = [];
  const overlays = [];
  const service = createChatService({
    imagePromptState: '/tmp/codexmobile-chat-service-test.json',
    getProject: () => ({ id: 'project-1', name: 'Project', path: '/tmp/project', projectless: false }),
    getSession: () => ({ id: 'thread-1', projectId: 'project-1' }),
    getCacheSnapshot: () => ({ config: { skills: [], model: 'gpt-5.5' } }),
    getDesktopBridgeStatus: async () => ({ strict: true, connected: true, mode: 'desktop-proxy', reason: null }),
    listProjectSessions: () => [],
    readSessionMessages: async () => ({ messages: [] }),
    refreshCodexCache: async () => ({ syncedAt: 'now', projects: [] }),
    renameSession: async () => null,
    broadcast: (payload) => broadcasts.push(payload),
    runCodexTurn: async () => 'thread-1',
    steerCodexTurn: async () => ({ accepted: true, delivery: 'steered', sessionId: 'thread-1', turnId: 'active-turn' }),
    startDesktopFollowerTurn: rejectDesktopFollowerTurn,
    steerDesktopFollowerTurn: rejectDesktopFollowerTurn,
    interruptDesktopFollowerTurn: async () => ({ interrupted: true }),
    setDesktopFollowerCollaborationMode: async () => ({ ok: true }),
    abortCodexTurn: () => true,
    getActiveRuns: () => [],
    runImageTurn: async () => 'thread-1',
    isImageRequest: () => false,
    useLegacyImageGenerator: () => false,
    maybeAutoNameSession: async () => false,
    preferDesktopIpcSend: true,
    registerProjectlessThread: async () => null,
    registerMobileSession: async () => null,
    reopenDesktopThread: async () => ({ triggered: true, restarted: true }),
    appendMobileSessionMessages: async (payload) => {
      overlays.push(payload);
      return payload;
    },
    rememberLiveSession: () => null,
    ...overrides
  });
  return { service, broadcasts, overlays };
}

async function flushQueuedWork() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('sendChat routes running input through local headless steer', async () => {
  let steerPayload = null;
  const { service, broadcasts } = makeChatService({
    steerCodexTurn: async (identifier, payload) => {
      steerPayload = { identifier, payload };
      return { accepted: true, delivery: 'steered', sessionId: 'thread-1', turnId: 'active-turn' };
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn',
    message: '补充这个方向',
    sendMode: 'steer'
  });

  assert.equal(result.delivery, 'steered');
  assert.equal(result.clientTurnId, 'client-turn');
  assert.equal(result.turnId, 'active-turn');
  assert.equal(steerPayload.identifier, 'thread-1');
  assert.match(steerPayload.payload.message, /补充这个方向/);
  assert.equal(broadcasts.some((payload) => payload.type === 'user-message'), true);
});

test('sendChat uses headless local even when the desktop bridge is unavailable', async () => {
  let runPayload = null;
  const { service, broadcasts, overlays } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: false,
      mode: 'unavailable',
      reason: '桌面端未连接'
    }),
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    message: 'hello'
  });

  assert.equal(result.accepted, true);
  assert.equal(result.desktopBridge.mode, 'headless-local');
  assert.equal(result.desktopBridge.connected, true);
  assert.equal(runPayload.sessionId, 'thread-1');
  assert.equal(broadcasts.some((payload) => payload.type === 'user-message'), true);
  assert.equal(overlays.at(0)?.id, 'thread-1');
  assert.equal(overlays.at(0)?.messages?.[0]?.content, 'hello');
  assert.equal(overlays.at(0)?.messages?.[0]?.deliveryState, 'confirmed');
});

test('sendChat immediately updates the live session cache from overlay writes', async () => {
  let remembered = null;
  const { service } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: false,
      mode: 'unavailable',
      reason: '桌面端未连接'
    }),
    rememberLiveSession: (session) => {
      remembered = session;
      return session;
    },
    runCodexTurn: async (payload, emit) => {
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    message: '同步桌面列表摘要'
  });

  assert.equal(remembered?.id, 'thread-1');
  assert.equal(remembered?.summary, '同步桌面列表摘要');
  assert.equal(Array.isArray(remembered?.messages), true);
  assert.equal(remembered?.messages?.at(-1)?.content, '同步桌面列表摘要');
});

test('sendChat persists a failed headless outcome into the session overlay', async () => {
  const { service, overlays } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: false,
      mode: 'unavailable',
      reason: '桌面端未连接'
    }),
    runCodexTurn: async (payload, emit) => {
      emit({
        type: 'chat-error',
        sessionId: payload.sessionId,
        turnId: payload.turnId,
        error: 'Selected model is at capacity. Please try a different model.'
      });
      return payload.sessionId;
    }
  });

  await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    message: 'hello again'
  });
  await flushQueuedWork();

  assert.equal(overlays.some((payload) =>
    payload.id === 'thread-1' &&
    payload.messages?.some((message) =>
      message.role === 'assistant' &&
      /任务失败：Selected model is at capacity/.test(message.content)
    )
  ), true);
});

test('abortChat records and broadcasts an aborted turn even after the backend run is gone', async () => {
  let abortedIdentifier = null;
  const { service, broadcasts } = makeChatService({
    abortCodexTurn: (identifier) => {
      abortedIdentifier = identifier;
      return false;
    }
  });

  const aborted = await service.abortChat({
    sessionId: 'thread-1',
    turnId: 'client-turn-1',
    previousSessionId: 'thread-1'
  }, { remoteAddress: '127.0.0.1' });

  assert.equal(aborted, true);
  assert.equal(abortedIdentifier, 'client-turn-1');
  assert.equal(service.getTurn('client-turn-1').status, 'aborted');
  assert.equal(service.getTurn('client-turn-1').sessionId, 'thread-1');
  assert.equal(broadcasts.at(-1).type, 'chat-aborted');
  assert.equal(broadcasts.at(-1).turnId, 'client-turn-1');
  assert.equal(broadcasts.at(-1).sessionId, 'thread-1');
});

test('compactChat calls desktop compact and broadcasts detected context state', async () => {
  let compactedSessionId = null;
  const { service, broadcasts } = makeChatService({
    compactCodexThread: async (sessionId) => {
      compactedSessionId = sessionId;
      return { compacted: true };
    }
  });

  const result = await service.compactChat({
    projectId: 'project-1',
    sessionId: 'thread-1'
  });

  assert.deepEqual(result, { accepted: true, sessionId: 'thread-1', result: { compacted: true } });
  assert.equal(compactedSessionId, 'thread-1');
  assert.equal(broadcasts.some((payload) =>
    payload.type === 'context-status-update' &&
    payload.sessionId === 'thread-1' &&
    payload.autoCompact?.detected === true
  ), true);
});

test('compactChat broadcasts a running activity before desktop compact finishes', async () => {
  let resolveCompact;
  const compactPromise = new Promise((resolve) => {
    resolveCompact = resolve;
  });
  const { service, broadcasts } = makeChatService({
    compactCodexThread: async () => compactPromise
  });

  const pending = service.compactChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientActionId: 'compact-action-1'
  });
  await new Promise((resolve) => setImmediate(resolve));

  const running = broadcasts.find((payload) =>
    payload.type === 'activity-update' &&
    payload.kind === 'context_compaction' &&
    payload.status === 'running'
  );
  assert.equal(running?.label, '正在压缩上下文');
  assert.equal(running?.messageId, 'compact-action-1');

  resolveCompact({ compacted: true });
  await pending;
  assert.equal(broadcasts.some((payload) =>
    payload.type === 'activity-update' &&
    payload.messageId === running.messageId &&
    payload.status === 'completed' &&
    payload.label === '上下文已压缩'
  ), true);
});

test('compactChat broadcasts a failed activity when desktop compact fails', async () => {
  const { service, broadcasts } = makeChatService({
    compactCodexThread: async () => {
      throw new Error('desktop compact failed');
    }
  });

  await assert.rejects(
    service.compactChat({
      projectId: 'project-1',
      sessionId: 'thread-1'
    }),
    /desktop compact failed/
  );

  assert.equal(broadcasts.some((payload) =>
    payload.type === 'activity-update' &&
    payload.kind === 'context_compaction' &&
    payload.status === 'failed' &&
    payload.label === '上下文压缩失败' &&
    /desktop compact failed/.test(payload.detail)
  ), true);
});

test('sendChat creates draft threads through headless even when desktop IPC cannot create desktop threads', async () => {
  let runPayload = null;
  const { service, broadcasts } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }),
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'thread-started', sessionId: 'headless-thread-1', previousSessionId: payload.draftSessionId, turnId: payload.turnId });
      emit({ type: 'chat-complete', sessionId: 'headless-thread-1', previousSessionId: payload.draftSessionId, turnId: payload.turnId });
      return 'headless-thread-1';
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-project-1-1',
    message: '手机新建一个同源对话'
  });

  assert.equal(result.accepted, true);
  assert.equal(result.desktopBridge.mode, 'headless-local');
  assert.equal(runPayload.draftSessionId, 'draft-project-1-1');
  assert.equal(broadcasts.some((payload) => payload.type === 'user-message'), true);
});

test('sendChat defaults to desktop IPC when an existing desktop thread is available', async () => {
  let started = false;
  let runPayload = null;
  const service = createChatService({
    imagePromptState: '/tmp/codexmobile-chat-service-test-default-headless.json',
    getProject: () => ({ id: 'project-1', name: 'Project', path: '/tmp/project', projectless: false }),
    getSession: () => ({ id: 'thread-1', projectId: 'project-1' }),
    getCacheSnapshot: () => ({ config: { skills: [], model: 'gpt-5.5' } }),
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }),
    listProjectSessions: () => [],
    readSessionMessages: async () => ({ messages: [] }),
    refreshCodexCache: async () => ({ syncedAt: 'now', projects: [] }),
    renameSession: async () => null,
    broadcast: () => null,
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    },
    startDesktopFollowerTurn: async () => {
      started = true;
      return { turn: { id: 'desktop-turn-should-not-run' } };
    },
    steerCodexTurn: async () => ({ accepted: true, delivery: 'steered', sessionId: 'thread-1', turnId: 'active-turn' }),
    interruptDesktopFollowerTurn: async () => ({ interrupted: true }),
    setDesktopFollowerCollaborationMode: async () => ({ ok: true }),
    abortCodexTurn: () => true,
    getActiveRuns: () => [],
    runImageTurn: async () => 'thread-1',
    isImageRequest: () => false,
    useLegacyImageGenerator: () => false,
    maybeAutoNameSession: async () => false,
    registerProjectlessThread: async () => null,
    registerMobileSession: async () => null,
    appendMobileSessionMessages: async (payload) => payload,
    rememberLiveSession: () => null
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-default-headless',
    message: '默认还是服务端接单'
  });

  assert.equal(result.accepted, true);
  assert.equal(result.desktopBridge.mode, 'desktop-ipc');
  assert.equal(result.turnId, 'desktop-turn-should-not-run');
  assert.equal(started, true);
  assert.equal(runPayload, null);
  assert.equal(service.getTurn('client-turn-default-headless')?.source, 'desktop-ipc');
});

test('sendChat prefers desktop IPC for existing desktop threads when the owner is available', async () => {
  let started = null;
  let runPayload = null;
  const { service, broadcasts, overlays } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: { sendToOpenDesktopThread: true, createThread: false, backgroundCodex: true }
    }),
    startDesktopFollowerTurn: async (conversationId, params) => {
      started = { conversationId, params };
      return { turn: { id: 'desktop-turn-1' } };
    },
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-1',
    message: '从手机优先交给桌面 IPC'
  });

  assert.equal(result.delivery, 'started');
  assert.equal(result.sessionId, 'thread-1');
  assert.equal(result.turnId, 'desktop-turn-1');
  assert.equal(result.clientTurnId, 'client-turn-1');
  assert.equal(result.desktopBridge.mode, 'desktop-ipc');
  assert.equal(started.conversationId, 'thread-1');
  assert.equal(started.params.input.at(-1).text, '从手机优先交给桌面 IPC');
  assert.equal(runPayload, null);
  assert.equal(service.getTurn('client-turn-1')?.source, 'desktop-ipc');
  assert.equal(broadcasts.some((payload) => payload.type === 'status-update' && payload.source === 'desktop-ipc'), true);
  const userMessage = broadcasts.find((payload) => payload.type === 'user-message');
  assert.equal(userMessage.turnId, 'desktop-turn-1');
  assert.equal(userMessage.clientTurnId, 'client-turn-1');
  assert.equal(userMessage.message.id, 'user-desktop-turn-1');
  assert.equal(userMessage.message.turnId, 'desktop-turn-1');
  assert.equal(overlays.at(-1)?.messages?.[0]?.id, 'user-desktop-turn-1');
  assert.equal(overlays.at(-1)?.messages?.[0]?.turnId, 'desktop-turn-1');
});

test('sendChat falls back to headless local when desktop follower owner is unavailable', async () => {
  let runPayload = null;
  const desktopRefreshes = [];
  const { service, broadcasts } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }),
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    },
    notifyDesktopThreadListChanged: async (payload) => {
      desktopRefreshes.push(payload);
      return { sent: true };
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    message: '从手机发到已有线程'
  });

  assert.equal(result.accepted, true);
  assert.equal(result.delivery, 'started');
  assert.equal(result.desktopBridge.mode, 'headless-local');
  assert.equal(result.deliveryMode, 'headless');
  assert.equal(runPayload.sessionId, 'thread-1');
  await flushQueuedWork();
  assert.equal(broadcasts.some((payload) => payload.type === 'status-update' && payload.source === 'headless-local'), true);
  assert.deepEqual(desktopRefreshes, []);
});

test('sendChat records desktop IPC runtime when an existing desktop thread accepts the turn', async () => {
  const { service, broadcasts } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }),
    startDesktopFollowerTurn: async () => ({ turn: { id: 'desktop-turn-1' } }),
    readSessionMessages: async () => ({ messages: [] })
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-1',
    message: '从手机发到后台 headless 运行'
  });

  assert.equal(result.turnId, 'desktop-turn-1');
  assert.equal(result.clientTurnId, 'client-turn-1');
  assert.equal(result.desktopBridge.mode, 'desktop-ipc');
  assert.equal(service.getTurn('client-turn-1')?.source, 'desktop-ipc');
  assert.equal(broadcasts.some((payload) =>
    payload.type === 'status-update' &&
    payload.source === 'desktop-ipc' &&
    payload.label === '桌面端已接管'
  ), true);
});

test('sendChat rejects a session id that belongs to another project', async () => {
  const { service } = makeChatService({
    getSession: (sessionId) => ({ id: sessionId, projectId: 'project-2' })
  });

  await assert.rejects(
    service.sendChat({
      projectId: 'project-1',
      sessionId: 'thread-cross-project',
      message: '这条不该串到别的项目'
    }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /Session does not belong to project/);
      return true;
    }
  );
});

test('sendChat does not resume a queued draft session from another project', async () => {
  let lastRunPayload = null;
  const projects = {
    'project-1': { id: 'project-1', name: 'Project 1', path: '/tmp/project-1', projectless: false },
    'project-2': { id: 'project-2', name: 'Project 2', path: '/tmp/project-2', projectless: false }
  };
  const sessions = {
    'thread-project-2': { id: 'thread-project-2', projectId: 'project-2' }
  };
  const { service } = makeChatService({
    getProject: (projectId) => projects[projectId] || null,
    getSession: (sessionId) => sessions[sessionId] || null,
    runCodexTurn: async (payload, emit) => {
      lastRunPayload = payload;
      if (payload.draftSessionId === 'draft-shared') {
        emit({
          type: 'thread-started',
          sessionId: 'thread-project-2',
          previousSessionId: payload.draftSessionId,
          turnId: payload.turnId
        });
      }
      emit({
        type: 'chat-complete',
        sessionId: payload.sessionId || 'thread-project-2',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId
      });
      return payload.sessionId || 'thread-project-2';
    }
  });

  await service.sendChat({
    projectId: 'project-2',
    draftSessionId: 'draft-shared',
    message: '先在项目 2 建线程'
  });

  await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-shared',
    message: '切到项目 1 后不能捡回项目 2 的线程'
  });

  assert.equal(lastRunPayload.sessionId, null);
  assert.equal(lastRunPayload.draftSessionId, 'draft-shared');
});

test('abortChat does not interrupt desktop IPC after mobile sends', async () => {
  const { service, broadcasts } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }),
    startDesktopFollowerTurn: async () => ({ turn: { id: 'desktop-turn-1' } }),
    readSessionMessages: async () => ({ messages: [] }),
    abortCodexTurn: () => false
  });

  await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-1',
    message: '准备从手机中止桌面 IPC'
  });

  const aborted = await service.abortChat({
    sessionId: 'thread-1',
    turnId: 'client-turn-1',
    previousSessionId: 'thread-1'
  }, { remoteAddress: '127.0.0.1' });

  assert.equal(aborted, true);
  assert.equal(service.getTurn('client-turn-1').status, 'aborted');
  assert.equal(broadcasts.filter((payload) => payload.type === 'chat-aborted' && payload.source === 'desktop-ipc').length, 0);
});

test('abortChat no longer falls back to desktop IPC when turn id does not match', async () => {
  const { service } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }),
    startDesktopFollowerTurn: async () => ({ turn: { id: 'desktop-turn-1' } }),
    readSessionMessages: async () => ({ messages: [] }),
    abortCodexTurn: () => false
  });

  await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-1',
    message: '准备用 session id 兜底中止'
  });

  const aborted = await service.abortChat({
    sessionId: 'thread-1',
    turnId: 'stale-mobile-turn-id'
  }, { remoteAddress: '127.0.0.1' });

  assert.equal(aborted, true);
  assert.equal(service.getTurn('stale-mobile-turn-id').status, 'aborted');
});

test('abortChat aborts an active headless run before a desktop IPC monitor on the same session', async () => {
  let abortedIdentifier = null;
  const { service, broadcasts } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }),
    startDesktopFollowerTurn: async () => ({ turn: { id: 'desktop-turn-1' } }),
    readSessionMessages: async () => ({ messages: [] }),
    getActiveRuns: () => [{
      sessionId: 'thread-1',
      previousSessionId: 'thread-1',
      turnId: 'headless-turn-1',
      status: 'running',
      source: 'headless-local'
    }],
    abortCodexTurn: (identifier) => {
      abortedIdentifier = identifier;
      return true;
    }
  });

  await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-1',
    message: '先创建一个桌面 monitor'
  });

  const aborted = await service.abortChat({
    sessionId: 'thread-1',
    turnId: 'headless-turn-1',
    previousSessionId: 'thread-1'
  }, { remoteAddress: '127.0.0.1' });

  assert.equal(aborted, true);
  assert.equal(abortedIdentifier, 'headless-turn-1');
  assert.equal(broadcasts.at(-1).type, 'chat-aborted');
  assert.equal(broadcasts.at(-1).source, 'headless-local');
  assert.equal(broadcasts.at(-1).turnId, 'headless-turn-1');
});

test('abortChat does not interrupt desktop-origin sessions from mobile', async () => {
  const { service, broadcasts } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }),
    abortCodexTurn: () => false
  });

  const aborted = await service.abortChat({
    projectId: 'project-1',
    sessionId: 'thread-1'
  }, { remoteAddress: '127.0.0.1' });

  assert.equal(aborted, false);
  assert.equal(broadcasts.length, 0);
});

test('abortChat clears a headless turn by session when activeRuns has already dropped it', async () => {
  let abortedIdentifier = null;
  const { service, broadcasts } = makeChatService({
    runCodexTurn: async () => new Promise(() => {}),
    abortCodexTurn: (identifier) => {
      abortedIdentifier = identifier;
      return false;
    }
  });

  await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-session-only',
    message: '这个任务会卡住'
  });

  const aborted = await service.abortChat({
    sessionId: 'thread-1'
  }, { remoteAddress: '127.0.0.1' });

  assert.equal(aborted, true);
  assert.equal(abortedIdentifier, 'client-turn-session-only');
  assert.equal(service.getTurn('client-turn-session-only').status, 'aborted');
  assert.equal(broadcasts.at(-1).type, 'chat-aborted');
  assert.equal(broadcasts.at(-1).turnId, 'client-turn-session-only');
});

test('headless runner rejection emits a terminal failure and frees the next send', async () => {
  let runCount = 0;
  const { service, broadcasts } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runCount += 1;
      if (runCount === 1) {
        throw new Error('Request failed: 404');
      }
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const first = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-fail',
    message: '第一次失败'
  });
  await flushQueuedWork();

  const second = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-after-fail',
    message: '第二次应该直接启动'
  });
  await flushQueuedWork();

  assert.equal(first.delivery, 'started');
  assert.equal(service.getTurn('client-turn-fail').status, 'failed');
  assert.equal(broadcasts.some((payload) => payload.type === 'chat-error' && payload.turnId === 'client-turn-fail'), true);
  assert.equal(second.delivery, 'started');
  assert.equal(service.getTurn('client-turn-after-fail').status, 'completed');
});

test('post-run cache refresh does not keep the conversation queue running', async () => {
  let runCount = 0;
  let refreshStarted = false;
  const routeBounces = [];
  const { service } = makeChatService({
    refreshCodexCache: async () => {
      refreshStarted = true;
      return new Promise(() => {});
    },
    runCodexTurn: async (payload, emit) => {
      runCount += 1;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    },
    triggerDesktopRefreshForThread: async (threadId, options) => {
      routeBounces.push({ threadId, options });
      return { triggered: true };
    }
  });

  const first = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-refresh-1',
    message: '第一次完成但刷新很慢'
  });
  await flushQueuedWork();

  const second = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-refresh-2',
    message: '第二次不能被刷新阻塞'
  });
  await flushQueuedWork();

  assert.equal(first.delivery, 'started');
  assert.equal(refreshStarted, true);
  assert.equal(second.delivery, 'started');
  assert.equal(runCount, 2);
  assert.deepEqual(routeBounces, [
    {
      threadId: 'thread-1',
      options: { reason: 'headless-turn-completed' }
    },
    {
      threadId: 'thread-1',
      options: { reason: 'headless-turn-completed' }
    }
  ]);
});

test('sendChat does not request a synthetic desktop refresh after desktop IPC already accepted the turn', async () => {
  const routeBounces = [];
  const { service } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }),
    startDesktopFollowerTurn: async () => ({ turn: { id: 'desktop-turn-refresh-1' } }),
    triggerDesktopRefreshForThread: async (threadId, options) => {
      routeBounces.push({ threadId, options });
      return { triggered: true };
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-existing-refresh',
    message: '手机端执行完以后桌面也刷新'
  });
  await flushQueuedWork();

  assert.equal(result.delivery, 'started');
  assert.deepEqual(routeBounces, []);
});

test('desktop IPC timeout retries once before succeeding', async () => {
  let attempts = 0;
  const { service, broadcasts } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }),
    startDesktopFollowerTurn: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw desktopTimeoutError('thread-follower-start-turn');
      }
      return { turn: { id: 'desktop-turn-after-retry-1' } };
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-timeout-retry',
    message: '桌面 IPC 超时后短重试'
  });

  assert.equal(result.delivery, 'started');
  assert.equal(result.desktopBridge.mode, 'desktop-ipc');
  assert.equal(result.turnId, 'desktop-turn-after-retry-1');
  assert.equal(attempts, 2);
  assert.equal(broadcasts.some((payload) =>
    payload.type === 'status-update' &&
    payload.source === 'desktop-ipc' &&
    payload.label === '桌面端已接管'
  ), true);
});

test('desktop IPC timeout does not fall back to headless takeover', async () => {
  const refreshCalls = [];
  const { service, broadcasts } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }),
    startDesktopFollowerTurn: async () => {
      throw desktopTimeoutError('thread-follower-start-turn');
    },
    runCodexTurn: async (payload, emit) => {
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    },
    triggerDesktopRefreshForThread: async (threadId, options) => {
      refreshCalls.push({ threadId, options });
      return { triggered: true };
    }
  });

  await assert.rejects(
    service.sendChat({
      projectId: 'project-1',
      sessionId: 'thread-1',
      clientTurnId: 'client-turn-timeout-refresh',
      message: '桌面 IPC 超时后不应后台接管'
    }),
    (error) => {
      assert.equal(error.code, 'CODEXMOBILE_DESKTOP_IPC_TIMEOUT');
      return true;
    }
  );
  await flushQueuedWork();

  assert.equal(broadcasts.some((payload) => payload.type === 'status-update' && payload.source === 'headless-local'), false);
  assert.deepEqual(refreshCalls, []);
});

test('sendChat sends plan requests through desktop collaboration IPC for existing threads', async () => {
  let started = null;
  let collaboration = null;
  const { service } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }),
    setDesktopFollowerCollaborationMode: async (conversationId, value) => {
      collaboration = { conversationId, value };
      return { ok: true };
    },
    startDesktopFollowerTurn: async (conversationId, params) => {
      started = { conversationId, params };
      return { turn: { id: 'desktop-plan-turn-1' } };
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    message: '先给我计划',
    collaborationMode: 'plan',
    model: 'gpt-5.5',
    reasoningEffort: 'high',
    serviceTier: 'fast'
  });

  assert.equal(result.delivery, 'started');
  assert.equal(result.desktopBridge.mode, 'desktop-ipc');
  assert.equal(started.conversationId, 'thread-1');
  assert.equal(started.params.input.at(-1).text, '先给我计划');
  assert.deepEqual(collaboration, {
    conversationId: 'thread-1',
    value: {
      mode: 'plan',
      settings: {
        model: 'gpt-5.5',
        reasoning_effort: 'high',
        developer_instructions: null
      }
    }
  });
});

test('sendChat leaves desktop collaboration mode untouched for normal desktop follow-up turns', async () => {
  let started = null;
  let collaborationCalled = false;
  const { service } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }),
    setDesktopFollowerCollaborationMode: async () => {
      collaborationCalled = true;
      return { ok: true };
    },
    startDesktopFollowerTurn: async (conversationId, params) => {
      started = { conversationId, params };
      return { turn: { id: 'desktop-turn-followup-1' } };
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    message: '执行计划'
  });

  assert.equal(result.delivery, 'started');
  assert.equal(result.desktopBridge.mode, 'desktop-ipc');
  assert.equal(started.conversationId, 'thread-1');
  assert.equal(collaborationCalled, false);
});

test('sendChat exits plan mode explicitly before implementing a plan on desktop threads', async () => {
  let started = null;
  let collaboration = null;
  const { service } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }),
    setDesktopFollowerCollaborationMode: async (conversationId, value) => {
      collaboration = { conversationId, value };
      return { ok: true };
    },
    startDesktopFollowerTurn: async (conversationId, params) => {
      started = { conversationId, params };
      return { turn: { id: 'desktop-plan-implement-1' } };
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    message: 'Implement plan.',
    collaborationMode: 'default',
    model: 'gpt-5.5',
    reasoningEffort: 'high'
  });

  assert.equal(result.delivery, 'started');
  assert.equal(result.desktopBridge.mode, 'desktop-ipc');
  assert.equal(started.conversationId, 'thread-1');
  assert.deepEqual(collaboration, {
    conversationId: 'thread-1',
    value: {
      mode: 'default',
      settings: {
        model: 'gpt-5.5',
        reasoning_effort: 'high',
        developer_instructions: null
      }
    }
  });
});

test('sendChat implements proposed plans through desktop IPC when the thread already belongs to desktop', async () => {
  let started = null;
  const { service, broadcasts } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: {
        sendToOpenDesktopThread: true,
        createThread: false,
        backgroundCodex: true
      }
    }),
    startDesktopFollowerTurn: async (conversationId, params) => {
      started = { conversationId, params };
      return { turn: { id: 'desktop-plan-turn-2' } };
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-plan-turn',
    message: 'Implement plan.',
    visibleMessage: '执行计划',
    collaborationMode: 'default',
    planImplementation: {
      planContent: '# 修复计划\n\n## Summary\n处理计划执行失败。'
    }
  });

  assert.equal(result.delivery, 'started');
  assert.equal(result.desktopBridge.mode, 'desktop-ipc');
  assert.equal(broadcasts.filter((payload) => payload.type === 'user-message').length, 1);
  assert.equal(broadcasts.some((payload) => payload.type === 'status-update' && payload.source === 'desktop-ipc'), true);
  assert.equal(started.conversationId, 'thread-1');
  assert.equal(started.params.input.at(-1).text, 'Implement plan.');
});

test('sendChat uses desktop IPC directly for existing desktop-ipc threads', async () => {
  let started = null;
  const { service, broadcasts } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: {
        sendToOpenDesktopThread: true,
        createThread: false,
        backgroundCodex: true
      }
    }),
    startDesktopFollowerTurn: async (conversationId, params) => {
      started = { conversationId, params };
      return { turn: { id: 'desktop-turn-2' } };
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn',
    message: '移动端发送只走后台'
  });

  assert.equal(result.accepted, true);
  assert.equal(result.delivery, 'started');
  assert.equal(result.desktopBridge.mode, 'desktop-ipc');
  assert.equal(started.conversationId, 'thread-1');
  assert.equal(started.params.input.at(-1).text, '移动端发送只走后台');
  assert.deepEqual(started.params.sandboxPolicy, {
    type: 'workspaceWrite',
    networkAccess: false,
    writableRoots: []
  });
  assert.equal(broadcasts.filter((payload) => payload.type === 'user-message').length, 1);
});

test('sendChat does not push mobile model settings into desktop IPC before start', async () => {
  const { service } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: {
        sendToOpenDesktopThread: true,
        createThread: false,
        backgroundCodex: true
      }
    }),
    startDesktopFollowerTurn: async () => ({ turn: { id: 'desktop-turn-model-1' } })
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn',
    message: '确认执行这个计划',
    model: 'gpt-5.5',
    reasoningEffort: 'medium'
  });

  assert.equal(result.accepted, true);
  assert.equal(result.desktopBridge.mode, 'desktop-ipc');
});

test('sendChat falls back to headless when desktop IPC owner handshake is unavailable', async () => {
  let runPayload = null;
  const { service } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: {
        sendToOpenDesktopThread: true,
        createThread: false,
        backgroundCodex: true
      }
    }),
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn',
    message: '移动端发送等待桌面 IPC 接管'
  });

  assert.equal(result.accepted, true);
  assert.equal(result.desktopBridge.mode, 'headless-local');
  assert.equal(result.deliveryMode, 'headless');
  assert.equal(runPayload.sessionId, 'thread-1');
});

test('sendChat accepts existing desktop-thread sends through headless before an IPC owner is available', async () => {
  let runPayload = null;
  const { service } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: {
        sendToOpenDesktopThread: true,
        createThread: false,
        backgroundCodex: true
      }
    }),
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn',
    message: '等桌面 owner 绑定后再执行'
  });

  assert.equal(result.accepted, true);
  assert.equal(result.desktopBridge.mode, 'headless-local');
  assert.equal(result.deliveryMode, 'headless');
  assert.equal(runPayload.sessionId, 'thread-1');
});

test('sendChat can create a background thread when desktop-ipc cannot create desktop threads', async () => {
  let runPayload = null;
  const { service } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: {
        sendToOpenDesktopThread: true,
        createThread: false,
        createThreadViaBackground: true,
        backgroundCodex: true
      }
    }),
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'thread-started', sessionId: 'background-thread-1', previousSessionId: payload.draftSessionId, turnId: payload.turnId });
      emit({ type: 'chat-complete', sessionId: 'background-thread-1', previousSessionId: payload.draftSessionId, turnId: payload.turnId });
      return 'background-thread-1';
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-project-1-1',
    clientTurnId: 'client-turn',
    message: '从手机后台新建'
  });

  assert.equal(result.accepted, true);
  assert.equal(result.delivery, 'started');
  assert.equal(result.desktopBridge.mode, 'headless-local');
  assert.equal(runPayload.draftSessionId, 'draft-project-1-1');
  assert.match(runPayload.message, /从手机后台新建/);
});

test('sendChat asks desktop to hot-refresh after a background thread is created', async () => {
  const desktopRefreshes = [];
  const routeBounces = [];
  const { service } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: {
        sendToOpenDesktopThread: true,
        createThread: false,
        createThreadViaBackground: true,
        backgroundCodex: true
      }
    }),
    runCodexTurn: async (payload, emit) => {
      emit({
        type: 'thread-started',
        sessionId: 'background-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId,
        cwd: '/tmp/project'
      });
      emit({
        type: 'chat-complete',
        sessionId: 'background-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId
      });
      return 'background-thread-1';
    },
    notifyDesktopThreadListChanged: async (payload) => {
      desktopRefreshes.push(payload);
      return { sent: true };
    },
    triggerDesktopRefreshForThread: async (threadId, options) => {
      routeBounces.push({ threadId, options });
      return { triggered: true };
    }
  });

  await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-project-1-1',
    clientTurnId: 'client-turn',
    message: '从手机后台新建'
  });
  await flushQueuedWork();

  assert.deepEqual(desktopRefreshes, [
    {
      threadId: 'background-thread-1',
      cwd: '/tmp/project',
      reason: 'background-thread-started'
    },
    {
      threadId: 'background-thread-1',
      cwd: '/tmp/project',
      reason: 'background-thread-completed'
    }
  ]);
  assert.deepEqual(routeBounces, [
    {
      threadId: 'background-thread-1',
      options: { reason: 'background-thread-completed' }
    }
  ]);
});

test('sendChat broadcasts desktop sync status when the server accepts a headless turn', async () => {
  const { service, broadcasts } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: false,
      mode: 'unavailable',
      reason: '桌面端未连接'
    })
  });

  await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-sync-1',
    message: '检查同步状态'
  });

  const statusEvent = broadcasts.find((payload) =>
    payload.type === 'sync-event' &&
    payload.event?.eventType === 'desktop.sync.status' &&
    payload.event?.status === 'sent_to_server'
  );
  assert.equal(Boolean(statusEvent), true);
  assert.equal(statusEvent.event.sessionId, 'thread-1');
});

test('sendChat broadcasts desktop refresh failure status when refresh could not be triggered', async () => {
  const { service, broadcasts } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: {
        sendToOpenDesktopThread: true,
        createThread: false,
        createThreadViaBackground: true,
        backgroundCodex: true
      }
    }),
    runCodexTurn: async (payload, emit) => {
      emit({
        type: 'thread-started',
        sessionId: 'background-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId,
        cwd: '/tmp/project'
      });
      emit({
        type: 'chat-complete',
        sessionId: 'background-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId
      });
      return 'background-thread-1';
    },
    notifyDesktopThreadListChanged: async () => ({ sent: true }),
    triggerDesktopRefreshForThread: async () => ({
      triggered: false,
      method: 'deep-link-bounce',
      reason: 'desktop-refresh-failed',
      error: 'bounce failed'
    })
  });

  await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-project-1-1',
    clientTurnId: 'client-turn-sync-2',
    message: '刷新失败测试'
  });
  await flushQueuedWork();

  const failureEvent = broadcasts.find((payload) =>
    payload.type === 'sync-event' &&
    payload.event?.eventType === 'desktop.sync.status' &&
    payload.event?.status === 'desktop_refresh_failed'
  );
  assert.equal(Boolean(failureEvent), true);
  assert.match(failureEvent.event.detail, /failed|失败/i);
});

test('sendChat reuses a background-created thread alias for later headless sends', async () => {
  const runPayloads = [];
  let desktopStarted = null;
  const { service } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: {
        sendToOpenDesktopThread: true,
        createThread: false,
        createThreadViaBackground: true,
        backgroundCodex: true
      }
    }),
    runCodexTurn: async (payload, emit) => {
      runPayloads.push(payload);
      emit({
        type: 'thread-started',
        sessionId: 'background-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId
      });
      emit({
        type: 'chat-complete',
        sessionId: 'background-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId
      });
      return 'background-thread-1';
    },
    startDesktopFollowerTurn: async (conversationId, params) => {
      desktopStarted = { conversationId, params };
      return { turn: { id: 'desktop-turn-after-background-1' } };
    }
  });

  const first = await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-project-1-1',
    clientTurnId: 'client-turn-1',
    message: '从手机后台新建'
  });
  await flushQueuedWork();

  const second = await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-project-1-1',
    clientTurnId: 'client-turn-2',
    message: '继续这条线程'
  });
  await flushQueuedWork();

  assert.equal(first.desktopBridge.mode, 'headless-local');
  assert.equal(second.desktopBridge.mode, 'desktop-ipc');
  assert.equal(second.sessionId, 'background-thread-1');
  assert.equal(second.delivery, 'started');
  assert.equal(runPayloads.at(0).draftSessionId, 'draft-project-1-1');
  assert.equal(desktopStarted.conversationId, 'background-thread-1');
  assert.equal(desktopStarted.params.input.at(-1).text, '继续这条线程');
});

test('sendChat registers new projectless background threads for mobile and desktop lists', async () => {
  let runPayload = null;
  let desktopRegistration = null;
  let mobileRegistration = null;
  const { service } = makeChatService({
    getProject: () => ({
      id: '__codexmobile_projectless__',
      name: '普通对话',
      path: '/tmp/codex-projectless',
      projectless: true
    }),
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: {
        sendToOpenDesktopThread: true,
        createThread: false,
        createThreadViaBackground: true,
        backgroundCodex: true
      }
    }),
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({
        type: 'thread-started',
        sessionId: 'projectless-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId,
        startedAt: '2026-05-07T08:00:00.000Z'
      });
      emit({
        type: 'chat-complete',
        sessionId: 'projectless-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId
      });
      return 'projectless-thread-1';
    },
    registerProjectlessThread: async (threadId, workspaceRoot) => {
      desktopRegistration = { threadId, workspaceRoot };
    },
    registerMobileSession: async (session) => {
      mobileRegistration = session;
    }
  });

  const result = await service.sendChat({
    projectId: '__codexmobile_projectless__',
    draftSessionId: 'draft-projectless-1',
    clientTurnId: 'client-turn',
    message: '你好呀',
    attachments: [
      { id: 'img-1', name: '午餐.png', path: '/tmp/lunch.png', mimeType: 'image/png', kind: 'image' }
    ]
  });
  await flushQueuedWork();

  assert.equal(result.accepted, true);
  assert.equal(runPayload.draftSessionId, 'draft-projectless-1');
  assert.match(runPayload.message, /图片: 午餐\.png \(\/tmp\/lunch\.png\)/);
  assert.match(runPayload.projectPath, /\/tmp\/codex-projectless\/\d{4}-\d{2}-\d{2}\/mobile-chat-/);
  assert.deepEqual(desktopRegistration, {
    threadId: 'projectless-thread-1',
    workspaceRoot: '/tmp/codex-projectless'
  });
  assert.equal(mobileRegistration.id, 'projectless-thread-1');
  assert.equal(mobileRegistration.projectless, true);
  assert.equal(mobileRegistration.summary, '你好呀');
  assert.match(mobileRegistration.messages[0].content, /!\[午餐\.png\]\(\/tmp\/lunch\.png\)/);
});

test('sendChat routes existing projectless sessions through headless without desktop owner takeover', async () => {
  let runPayload = null;
  let desktopStarted = false;
  const { service } = makeChatService({
    getProject: () => ({
      id: '__codexmobile_projectless__',
      name: '普通对话',
      path: '/tmp/codex-projectless',
      projectless: true
    }),
    getSession: () => ({
      id: 'projectless-thread-1',
      projectId: '__codexmobile_projectless__',
      cwd: '/tmp/codex-projectless/2026-06-02/existing-thread',
      projectless: true
    }),
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: {
        sendToOpenDesktopThread: true,
        createThread: false,
        createThreadViaBackground: true,
        backgroundCodex: true
      }
    }),
    startDesktopFollowerTurn: async () => {
      desktopStarted = true;
      throw desktopOwnerUnavailableError();
    },
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: '__codexmobile_projectless__',
    sessionId: 'projectless-thread-1',
    clientTurnId: 'client-turn',
    message: '继续普通对话'
  });
  await flushQueuedWork();

  assert.equal(result.accepted, true);
  assert.equal(result.desktopBridge.mode, 'headless-local');
  assert.equal(desktopStarted, false);
  assert.equal(runPayload.sessionId, 'projectless-thread-1');
  assert.equal(runPayload.projectPath, '/tmp/codex-projectless/2026-06-02/existing-thread');
});

test('sendChat remembers a started background thread path before broadcasting it', async () => {
  const events = [];
  const { service } = makeChatService({
    broadcast: (payload) => events.push(`broadcast:${payload.type}`),
    rememberLiveSession: (session) => events.push(`remember:${session.id}:${session.filePath}`),
    getDesktopBridgeStatus: async () => ({
      strict: true,
      connected: true,
      mode: 'desktop-ipc',
      reason: null,
      capabilities: {
        sendToOpenDesktopThread: true,
        createThread: false,
        createThreadViaBackground: true,
        backgroundCodex: true
      }
    }),
    runCodexTurn: async (payload, emit) => {
      emit({
        type: 'thread-started',
        sessionId: 'background-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId,
        filePath: '/tmp/background-rollout.jsonl',
        startedAt: '2026-05-07T08:00:00.000Z'
      });
      emit({
        type: 'chat-complete',
        sessionId: 'background-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId
      });
      return 'background-thread-1';
    }
  });

  await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-project-1',
    clientTurnId: 'client-turn',
    message: '后台新线程'
  });
  await flushQueuedWork();

  const rememberedIndex = events.findIndex((event) => event === 'remember:background-thread-1:/tmp/background-rollout.jsonl');
  const broadcastIndex = events.findIndex((event) => event === 'broadcast:thread-started');
  assert.ok(rememberedIndex >= 0);
  assert.ok(broadcastIndex > rememberedIndex);
});

test('sendChat starts project-bound draft threads in the selected project cwd', async () => {
  let runPayload = null;
  let projectlessRegistrationCount = 0;
  let mobileRegistration = null;
  const { service } = makeChatService({
    getProject: () => ({
      id: 'project-codexmobile',
      name: 'CodexMobile',
      path: '/Users/xiayanghui/Code/CodexMobile',
      projectless: false
    }),
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({
        type: 'thread-started',
        sessionId: 'project-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId,
        cwd: payload.projectPath,
        startedAt: '2026-05-14T12:00:00.000Z'
      });
      emit({
        type: 'chat-complete',
        sessionId: 'project-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId
      });
      return 'project-thread-1';
    },
    registerProjectlessThread: async () => {
      projectlessRegistrationCount += 1;
    },
    registerMobileSession: async (session) => {
      mobileRegistration = session;
    }
  });

  await service.sendChat({
    projectId: 'project-codexmobile',
    draftSessionId: 'draft-project-codexmobile-1',
    clientTurnId: 'client-turn',
    message: '在项目里开新线程'
  });
  await flushQueuedWork();

  assert.equal(runPayload.projectPath, '/Users/xiayanghui/Code/CodexMobile');
  assert.equal(projectlessRegistrationCount, 0);
  assert.equal(mobileRegistration.projectPath, '/Users/xiayanghui/Code/CodexMobile');
  assert.equal(mobileRegistration.projectless, false);
});

test('sendChat starts a headless local Codex turn when desktop bridge is in headless mode', async () => {
  let runPayload = null;
  const { service, broadcasts } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: false,
      connected: true,
      mode: 'headless-local',
      reason: '桌面端未打开，正在使用后台 Codex',
      capabilities: { read: true, createThread: true, sendToOpenDesktopThread: false }
    }),
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'thread-started', sessionId: 'headless-thread-1', previousSessionId: payload.draftSessionId, turnId: payload.turnId });
      emit({ type: 'chat-complete', sessionId: 'headless-thread-1', previousSessionId: payload.draftSessionId, turnId: payload.turnId });
      return 'headless-thread-1';
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-project-1-1',
    clientTurnId: 'client-turn',
    message: '桌面端没开也跑一下'
  });

  assert.equal(result.accepted, true);
  assert.equal(result.delivery, 'started');
  assert.equal(result.desktopBridge.mode, 'headless-local');
  assert.equal(runPayload.draftSessionId, 'draft-project-1-1');
  assert.match(runPayload.message, /桌面端没开也跑一下/);
  assert.equal(broadcasts.some((payload) => payload.type === 'user-message'), true);
  assert.equal(broadcasts.find((payload) => payload.type === 'thread-started')?.source, 'headless-local');
  assert.equal(broadcasts.find((payload) => payload.type === 'chat-complete')?.source, 'headless-local');
});

test('sendChat passes plan collaboration mode to headless local Codex turns', async () => {
  let runPayload = null;
  const { service } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: false,
      connected: true,
      mode: 'headless-local',
      reason: '桌面端未打开，正在使用后台 Codex',
      capabilities: { read: true, createThread: true, sendToOpenDesktopThread: false }
    }),
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'thread-started', sessionId: 'headless-plan-thread-1', previousSessionId: payload.draftSessionId, turnId: payload.turnId });
      emit({ type: 'chat-complete', sessionId: 'headless-plan-thread-1', previousSessionId: payload.draftSessionId, turnId: payload.turnId });
      return 'headless-plan-thread-1';
    }
  });

  await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-project-1-1',
    message: '先规划一下',
    collaborationMode: 'plan',
    model: 'gpt-5.5',
    reasoningEffort: 'high',
    serviceTier: 'fast'
  });

  assert.equal(runPayload.serviceTier, 'fast');
  assert.deepEqual(runPayload.collaborationMode, {
    mode: 'plan',
    settings: {
      model: 'gpt-5.5',
      reasoning_effort: 'high',
      developer_instructions: null
    }
  });
});

test('queue drafts can be listed, deleted, and restored without auto starting during active work', async () => {
  const { service } = makeChatService({
    getActiveRuns: () => [{ sessionId: 'thread-1', status: 'running' }],
    getCacheSnapshot: () => ({
      config: {
        model: 'gpt-5.5',
        skills: [{ name: 'frontend-design', path: '/skills/frontend-design/SKILL.md' }]
      }
    })
  });

  const first = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'queued-turn-1',
    message: '排队草稿 1',
    sendMode: 'queue',
    selectedSkills: [{ path: '/skills/frontend-design/SKILL.md' }],
    fileMentions: [{ name: 'App.jsx', path: '/repo/client/src/App.jsx' }]
  });
  const second = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'queued-turn-2',
    message: '排队草稿 2',
    sendMode: 'queue'
  });

  assert.equal(first.delivery, 'queued');
  assert.equal(second.delivery, 'queued');
  let queue = service.listQueue({ sessionId: 'thread-1' });
  assert.equal(queue.drafts.length, 2);
  assert.equal(queue.drafts[0].text, '排队草稿 1');
  assert.equal(queue.drafts[0].selectedSkills[0].path, '/skills/frontend-design/SKILL.md');
  assert.equal(queue.drafts[0].fileMentions[0].path, '/repo/client/src/App.jsx');

  const deleted = service.removeQueuedDraft({ sessionId: 'thread-1', draftId: 'queued-turn-2' });
  assert.equal(deleted.text, '排队草稿 2');
  queue = service.listQueue({ sessionId: 'thread-1' });
  assert.equal(queue.drafts.length, 1);

  const restored = service.restoreQueuedDraft({ sessionId: 'thread-1', draftId: 'queued-turn-1' });
  assert.equal(restored.text, '排队草稿 1');
  assert.equal(service.listQueue({ sessionId: 'thread-1' }).drafts.length, 0);
});

test('queued drafts can be steered into the current turn', async () => {
  let steerPayload = null;
  const { service } = makeChatService({
    getActiveRuns: () => [{ sessionId: 'thread-1', status: 'running' }],
    steerCodexTurn: async (identifier, payload) => {
      steerPayload = { identifier, payload };
      return { sessionId: 'thread-1', turnId: 'steered-turn' };
    }
  });

  await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'queued-steer-1',
    message: '马上补充这句',
    fileMentions: [{ name: 'server.js', path: '/repo/server/index.js' }],
    sendMode: 'queue'
  });

  const result = await service.steerQueuedDraft({
    projectId: 'project-1',
    sessionId: 'thread-1',
    draftId: 'queued-steer-1'
  });

  assert.equal(result.delivery, 'steered');
  assert.equal(steerPayload.identifier, 'thread-1');
  assert.match(steerPayload.payload.message, /马上补充这句/);
  assert.match(steerPayload.payload.message, /引用文件路径/);
  assert.match(steerPayload.payload.message, /\/repo\/server\/index\.js/);
  assert.equal(service.listQueue({ sessionId: 'thread-1' }).drafts.length, 0);
});

test('file mentions are appended to normal chat sends', async () => {
  let runPayload = null;
  const { service } = makeChatService({
    getDesktopBridgeStatus: async () => ({
      strict: false,
      connected: true,
      mode: 'headless-local',
      reason: null,
      capabilities: { read: true, createThread: true, sendToOpenDesktopThread: false }
    }),
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    message: '看文件',
    fileMentions: [{ name: 'App.jsx', path: '/repo/client/src/App.jsx' }]
  });

  assert.match(runPayload.message, /看文件/);
  assert.match(runPayload.message, /引用文件路径/);
  assert.match(runPayload.message, /App\.jsx \(\/repo\/client\/src\/App\.jsx\)/);
});
