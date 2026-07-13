/**
 * 统一同步事件模型：把旧 WS payload 归一化为 SyncEvent，供服务端 store 与前端 reducer 使用。
 *
 * Keywords: sync-event, websocket, runtime, normalize, legacy-payload
 *
 * Exports:
 * - normalizeLegacyPayloadToSyncEvents — 将旧广播 payload 转为一个或多个 SyncEvent。
 * - runKeysForSyncEvent — 计算事件可命中的 runtime/session key。
 * - isTerminalSyncEvent / isRuntimeSyncEvent — 判定事件生命周期。
 *
 * Inward（本模块依赖/组装的关键符号）: 仅使用标准运行时工具函数。
 *
 * Outward（谁在用/调用场景）: sync-bridge、sync-store、后端同步测试。
 *
 * 不负责: WebSocket 发送、Codex 原始事件解析。
 */

const RUNTIME_EVENT_TYPES = new Set([
  'turn.submitted',
  'turn.accepted',
  'turn.running',
  'turn.queued',
  'turn.completed',
  'turn.failed',
  'turn.aborted'
]);

const TERMINAL_EVENT_TYPES = new Set(['turn.completed', 'turn.failed', 'turn.aborted']);

function nowIso() {
  return new Date().toISOString();
}

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}

function eventId(prefix = 'sync') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function baseEvent(payload = {}, eventType, extra = {}) {
  const timestamp = clean(payload.timestamp) || clean(payload.completedAt) || clean(payload.startedAt) || nowIso();
  return {
    id: eventId(eventType.replaceAll('.', '-')),
    eventType,
    legacyType: clean(payload.type),
    source: clean(payload.source) || 'server',
    projectId: clean(payload.projectId),
    sessionId: clean(payload.sessionId),
    previousSessionId: clean(payload.previousSessionId),
    draftSessionId: clean(payload.draftSessionId),
    turnId: clean(payload.turnId),
    clientTurnId: clean(payload.clientTurnId),
    status: clean(payload.status),
    label: clean(payload.label),
    detail: clean(payload.detail),
    startedAt: clean(payload.startedAt),
    completedAt: clean(payload.completedAt),
    durationMs: Number.isFinite(Number(payload.durationMs)) ? Number(payload.durationMs) : null,
    timestamp,
    ...extra
  };
}

function turnEventTypeForStatus(status, fallback = 'turn.running') {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'queued') {
    return 'turn.queued';
  }
  if (value === 'running') {
    return 'turn.running';
  }
  if (value === 'completed' || value === 'complete' || value === 'idle') {
    return 'turn.completed';
  }
  if (value === 'failed' || value === 'error') {
    return 'turn.failed';
  }
  if (value === 'aborted' || value === 'cancelled' || value === 'canceled') {
    return 'turn.aborted';
  }
  return fallback;
}

function visibleUserMessage(payload = {}) {
  if (!payload.message || typeof payload.message !== 'object') {
    return null;
  }
  return {
    ...payload.message,
    sessionId: payload.message.sessionId || payload.sessionId || null,
    turnId: payload.message.turnId || payload.turnId || payload.clientTurnId || null
  };
}

function assistantMessage(payload = {}) {
  return {
    id: payload.messageId || payload.id || null,
    role: 'assistant',
    content: payload.content || '',
    timestamp: payload.timestamp || nowIso(),
    sessionId: payload.sessionId || null,
    turnId: payload.turnId || payload.clientTurnId || null,
    done: payload.done !== false,
    phase: payload.phase || null,
    planImplementation: payload.planImplementation || null
  };
}

function shouldSuppressInternalHandoff(payload = {}) {
  const source = String(payload.source || '').trim();
  const label = `${payload.label || ''} ${payload.detail || ''}`.trim();
  if (source === 'desktop-ipc' && payload.type === 'status-update') {
    return true;
  }
  return /已交给桌面端处理|后台启动中|正在完成\s*\d+\s*步操作/.test(label);
}

export function normalizeLegacyPayloadToSyncEvents(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  if (payload.type === 'sync-event') {
    return payload.event ? [payload.event] : [];
  }
  if (payload.type === 'sync-state' || payload.type === 'connected') {
    return [];
  }

  if (payload.type === 'chat-started') {
    return [baseEvent(payload, 'turn.running', { status: 'running' })];
  }
  if (payload.type === 'thread-started') {
    return [
      baseEvent(payload, 'thread.started', {
        session: payload.session || null,
        status: payload.status || 'running'
      }),
      baseEvent(payload, 'turn.running', { status: 'running' })
    ];
  }
  if (payload.type === 'user-message') {
    const message = visibleUserMessage(payload);
    return message ? [baseEvent(payload, 'message.user', { message })] : [];
  }
  if (payload.type === 'message-deleted') {
    return [
      baseEvent(payload, 'message.deleted', {
        messageId: payload.messageId || payload.id || null
      })
    ];
  }
  if (payload.type === 'assistant-update') {
    if (!String(payload.content || '').trim()) {
      return [];
    }
    return [
      baseEvent(payload, payload.done === false ? 'message.assistant.delta' : 'message.assistant.completed', {
        message: assistantMessage(payload),
        status: payload.done === false ? 'running' : 'completed'
      })
    ];
  }
  if (payload.type === 'status-update') {
    const eventType = turnEventTypeForStatus(payload.status, 'turn.running');
    return [baseEvent(payload, eventType, { suppressedInChat: shouldSuppressInternalHandoff(payload) })];
  }
  if (payload.type === 'activity-update') {
    const status = String(payload.status || 'running').trim();
    const suffix = TERMINAL_EVENT_TYPES.has(turnEventTypeForStatus(status))
      ? status === 'failed' ? 'failed' : 'completed'
      : 'updated';
    return [
      baseEvent(payload, `activity.${suffix}`, {
        activity: { ...payload },
        suppressedInChat: shouldSuppressInternalHandoff(payload)
      })
    ];
  }
  if (payload.type === 'interaction-request') {
    return [
      baseEvent(payload, 'interaction.requested', {
        interaction: payload.interaction || null,
        status: payload.status || 'pending'
      })
    ];
  }
  if (payload.type === 'interaction-resolved') {
    return [
      baseEvent(payload, 'interaction.resolved', {
        interactionId: payload.interactionId || payload.id || null,
        status: payload.status || 'completed'
      })
    ];
  }
  if (payload.type === 'context-status-update') {
    return [baseEvent(payload, 'context.updated', { context: { ...payload } })];
  }
  if (payload.type === 'model-settings-updated') {
    return [
      baseEvent(payload, 'model.updated', {
        model: payload.model || null,
        modelShort: payload.modelShort || null,
        reasoningEffort: payload.reasoningEffort || null,
        provider: payload.provider || null,
        desktopSync: payload.desktopSync || null
      })
    ];
  }
  if (payload.type === 'chat-complete') {
    return [baseEvent(payload, 'turn.completed', { status: 'completed', context: payload.context || null })];
  }
  if (payload.type === 'chat-error') {
    return [baseEvent(payload, 'turn.failed', { status: 'failed', detail: payload.error || payload.detail || null })];
  }
  if (payload.type === 'chat-aborted') {
    return [baseEvent(payload, 'turn.aborted', { status: 'aborted' })];
  }
  if (payload.type === 'desktop-thread-updated') {
    const status = clean(payload.status);
    if (!status) {
      return [baseEvent(payload, 'thread.updated', { source: 'desktop-ipc' })];
    }
    return [baseEvent(payload, turnEventTypeForStatus(status, 'turn.running'), { status, source: 'desktop-ipc' })];
  }
  if (payload.type === 'session-renamed') {
    return [
      baseEvent(payload, 'thread.renamed', {
        session: payload.session || null,
        title: payload.title || payload.session?.title || null,
        titleLocked: payload.titleLocked ?? payload.session?.titleLocked ?? true
      })
    ];
  }
  if (payload.type === 'sync-complete') {
    return [
      baseEvent(payload, 'sessions.synced', {
        projects: Array.isArray(payload.projects) ? payload.projects : [],
        syncedAt: payload.syncedAt || nowIso()
      })
    ];
  }
  return [];
}

export function runKeysForSyncEvent(event = {}) {
  return [
    event.turnId,
    event.clientTurnId,
    event.sessionId,
    event.previousSessionId,
    event.draftSessionId
  ].filter(Boolean).map(String);
}

export function isRuntimeSyncEvent(event = {}) {
  return RUNTIME_EVENT_TYPES.has(String(event.eventType || ''));
}

export function isTerminalSyncEvent(event = {}) {
  return TERMINAL_EVENT_TYPES.has(String(event.eventType || ''));
}
