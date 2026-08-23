/**
 * 统一同步 WebSocket 消费器：处理 sync-event/sync-state，并把消息、活动与交互请求投影到 UI。
 *
 * Keywords: sync-socket, websocket, runtime, messages, reducer
 *
 * Exports:
 * - applySyncSocketPayload — 在 useAppWebSocket 中消费统一同步 payload。
 *
 * Inward（本模块依赖/组装的关键符号）: sync-reducer、activity-model、interaction-model、message-identity、context-status。
 *
 * Outward（谁在用/调用场景）: app/useAppWebSocket.js。
 *
 * 不负责: 建立 WebSocket 连接。
 */

import {
  applySyncRuntimeEvent,
  isSyncRunningEvent,
  isSyncTerminalEvent,
  mergeSyncStateRuntime,
  sessionMatchesSyncEvent,
  syncEventRunKeys
} from './sync-reducer.js';
import {
  upsertActivityMessage,
  upsertAssistantMessage,
  upsertStatusMessage
} from '../chat/activity-model.js';
import {
  resolveInteractionRequestMessage,
  upsertInteractionRequestMessage
} from '../chat/interaction-model.js';
import { sameUserMessageContent } from '../chat/message-identity.js';
import { mergeContextStatus } from '../app/context-status.js';

function syncEventPayloadForLegacy(event = {}) {
  return {
    source: event.source || null,
    projectId: event.projectId || null,
    sessionId: event.sessionId || null,
    previousSessionId: event.previousSessionId || null,
    draftSessionId: event.draftSessionId || null,
    turnId: event.turnId || event.clientTurnId || null,
    clientTurnId: event.clientTurnId || null,
    status: event.status || null,
    label: event.label || null,
    detail: event.detail || null,
    startedAt: event.startedAt || null,
    completedAt: event.completedAt || null,
    timestamp: event.timestamp || new Date().toISOString()
  };
}

function syncEventMatchesCurrent(event, selectedSessionRef) {
  return sessionMatchesSyncEvent(selectedSessionRef.current, event);
}

export function shouldPromoteCurrentDraftToThread(currentSession = null, event = {}, projectId = '') {
  if (!currentSession || !event?.sessionId) {
    return false;
  }
  const matchedDraftId = String(event.draftSessionId || event.previousSessionId || '').trim();
  if (!matchedDraftId || String(currentSession.id || '') !== matchedDraftId) {
    return false;
  }
  if (!currentSession.draft && !event.threadFallback) {
    return false;
  }
  if (
    projectId &&
    currentSession.projectId &&
    String(currentSession.projectId) !== String(projectId)
  ) {
    return false;
  }
  return true;
}

function desktopSyncLabel(status = '', detail = '') {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'queued') return '已进入发送队列';
  if (normalized === 'sent_to_server') return '已发送到电脑端';
  if (normalized === 'desktop_ipc_accepted') return '电脑端已接收';
  if (normalized === 'codex_turn_started') return 'Codex 正在执行';
  if (normalized === 'desktop_refresh_requested') return '已请求桌面端刷新';
  if (normalized === 'desktop_refresh_succeeded') return '桌面端刷新已触发';
  if (normalized === 'desktop_refresh_failed') return '桌面端刷新失败';
  if (normalized === 'completed') return '任务完成';
  if (normalized === 'failed') return detail ? '任务失败' : '任务失败';
  return '同步状态已更新';
}

function desktopSyncMessageStatus(status = '') {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'desktop_refresh_failed' || normalized === 'failed') {
    return 'failed';
  }
  if (normalized === 'completed' || normalized === 'desktop_refresh_succeeded') {
    return 'completed';
  }
  return 'running';
}

function updateSessionPreviewForEvent(event = {}, context = {}) {
  const projectId = String(event.projectId || event.session?.projectId || '').trim();
  const sessionId = String(event.sessionId || event.message?.sessionId || event.session?.id || '').trim();
  if (!projectId || !sessionId || typeof context.setSessionsByProject !== 'function') {
    return;
  }
  const preview = String(event.message?.content || '').trim();
  const timestamp = event.message?.timestamp || event.timestamp || new Date().toISOString();
  context.setSessionsByProject((current = {}) => {
    const projectSessions = Array.isArray(current[projectId]) ? current[projectId] : [];
    const existing = projectSessions.find((session) => String(session?.id || '') === sessionId);
    if (!existing) {
      if (typeof context.upsertSessionInProject !== 'function') {
        return current;
      }
      return context.upsertSessionInProject(current, projectId, {
        ...(event.session || {}),
        id: sessionId,
        projectId,
        summary: preview || event.session?.summary || '来自移动端的新消息',
        updatedAt: timestamp,
        messageCount: 1
      });
    }
    const nextSession = {
      ...existing,
      updatedAt: timestamp,
      ...(preview ? { summary: preview } : {}),
      ...(Number.isFinite(Number(existing.messageCount))
        ? { messageCount: Number(existing.messageCount) + 1 }
        : {})
    };
    return context.upsertSessionInProject(current, projectId, nextSession);
  });
}

function updateSessionPreviewFromAssistantEvent(event = {}, context = {}) {
  const content = String(event.message?.content || '').trim();
  if (!content) {
    return;
  }
  updateSessionPreviewForEvent({
    ...event,
    message: {
      ...(event.message || {}),
      content,
      timestamp: event.message?.timestamp || event.timestamp || new Date().toISOString()
    }
  }, context);
}

function applyRuntimeStateFromSnapshot(state, { setThreadRuntimeById, setRunningById, runningByIdRef }) {
  if (!state || typeof state !== 'object') {
    return;
  }
  const mergedRuntime = setThreadRuntimeById((current) => mergeSyncStateRuntime(current, state));
  const nextRunning = {};
  for (const [key, runtime] of Object.entries(mergedRuntime || {})) {
    if (runtime?.status === 'running' || runtime?.status === 'queued') {
      nextRunning[key] = true;
    }
  }
  runningByIdRef.current = nextRunning;
  setRunningById(nextRunning);
}

function clearRuntimeForEvent(event, { clearRun, setThreadRuntimeById }) {
  const payload = syncEventPayloadForLegacy(event);
  clearRun(payload);
  setThreadRuntimeById((current) => applySyncRuntimeEvent(current, event));
}

function confirmExistingUserMessageOnly(current, event) {
  const incoming = {
    ...event.message,
    sessionId: event.message.sessionId || event.sessionId || null,
    turnId: event.message.turnId || event.turnId || event.clientTurnId || null,
    deliveryState: 'confirmed'
  };
  const runKeys = new Set([event.turnId, event.clientTurnId, incoming.turnId].filter(Boolean).map(String));
  const reconcileIndex = current.findIndex((message) =>
    message.role === 'user' &&
    message.deliveryState !== 'failed' &&
    sameUserMessageContent(message.content, incoming.content) &&
    (
      message.deliveryState === 'pending' ||
      String(message.id || '').startsWith('local-') ||
      (!message.turnId && !message.sessionId) ||
      (
        message.deliveryState === 'confirmed' &&
        (
          (!incoming.sessionId || !message.sessionId || String(message.sessionId) === String(incoming.sessionId)) &&
          (!runKeys.size || !message.turnId || runKeys.has(String(message.turnId)))
        )
      )
    ) &&
    (
      (!incoming.sessionId || !message.sessionId || String(message.sessionId) === String(incoming.sessionId)) &&
      (!runKeys.size || !message.turnId || runKeys.has(String(message.turnId)))
    )
  );
  if (reconcileIndex < 0) {
    return current;
  }
  return current.map((message, index) =>
    index === reconcileIndex
      ? {
        ...message,
        id: incoming.id || message.id,
        sessionId: incoming.sessionId || message.sessionId || null,
        turnId: incoming.turnId || message.turnId || null,
        deliveryState: 'confirmed',
        timestamp: incoming.timestamp || message.timestamp
      }
      : message
  );
}

function alreadyHasConfirmedUserMessage(current, incoming) {
  const incomingId = String(incoming.id || '').trim();
  const incomingSessionId = String(incoming.sessionId || '').trim();
  const incomingTurnId = String(incoming.turnId || '').trim();
  return current.some((message) => {
    if (message.role !== 'user') {
      return false;
    }
    if (incomingId && String(message.id || '').trim() === incomingId) {
      return true;
    }
    if (!sameUserMessageContent(message.content, incoming.content)) {
      return false;
    }
    const sameSession = incomingSessionId && String(message.sessionId || '').trim() === incomingSessionId;
    const sameTurn = incomingTurnId && String(message.turnId || '').trim() === incomingTurnId;
    return sameSession && sameTurn;
  });
}

function reconcileOrAppendCurrentUserMessage(current, event) {
  const incoming = {
    ...event.message,
    sessionId: event.message.sessionId || event.sessionId || null,
    turnId: event.message.turnId || event.turnId || event.clientTurnId || null,
    deliveryState: 'confirmed',
    timestamp: event.message.timestamp || event.timestamp || new Date().toISOString()
  };
  if (alreadyHasConfirmedUserMessage(current, incoming)) {
    return current;
  }
  const reconciled = confirmExistingUserMessageOnly(current, event);
  if (reconciled !== current) {
    return reconciled;
  }
  return [...current, incoming];
}

function isCommentaryAssistantMessage(event = {}) {
  const phase = String(event.message?.phase || event.phase || '').trim().toLowerCase();
  return phase === 'commentary';
}

function normalizedInlineText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function removeAssistantMessageCoveredByProcessText(current, descriptor = {}) {
  const ids = new Set([
    descriptor.messageId,
    descriptor.itemId,
    descriptor.id
  ].filter(Boolean).map(String));
  const content = normalizedInlineText(descriptor.content);
  const turnId = descriptor.turnId ? String(descriptor.turnId) : '';
  const sessionId = descriptor.sessionId ? String(descriptor.sessionId) : '';
  if (!ids.size && !content) {
    return current;
  }
  return current.filter((message) => {
    if (message.role !== 'assistant') {
      return true;
    }
    if (ids.has(String(message.id || ''))) {
      return false;
    }
    if (!content || normalizedInlineText(message.content) !== content) {
      return true;
    }
    const sameTurn = turnId && message.turnId && String(message.turnId) === turnId;
    const sameSession = sessionId && message.sessionId && String(message.sessionId) === sessionId;
    return !(sameTurn || sameSession);
  });
}

function commentaryDescriptorFromAssistantEvent(event = {}) {
  return {
    id: event.message?.id || event.messageId || event.id || null,
    messageId: event.message?.id || event.messageId || event.id || null,
    itemId: event.message?.id || event.messageId || event.id || null,
    turnId: event.message?.turnId || event.turnId || event.clientTurnId || null,
    sessionId: event.message?.sessionId || event.sessionId || null,
    content: event.message?.content || ''
  };
}

function commentaryDescriptorFromActivityEvent(event = {}) {
  const activity = event.activity || {};
  return {
    id: activity.id || activity.messageId || event.id || null,
    messageId: activity.messageId || activity.id || event.id || null,
    itemId: activity.itemId || activity.messageId || activity.id || event.id || null,
    turnId: activity.turnId || event.turnId || event.clientTurnId || null,
    sessionId: activity.sessionId || event.sessionId || null,
    content: activity.content || activity.label || activity.detail || ''
  };
}

function isCommentaryActivity(event = {}) {
  const activity = event.activity || {};
  const phase = String(activity.phase || event.phase || '').trim().toLowerCase();
  return (activity.kind === 'agent_message' || activity.kind === 'message') && phase === 'commentary';
}

function commentaryActivityPayload(event = {}, legacyPayload = {}) {
  const content = String(event.message?.content || '').trim();
  return {
    ...legacyPayload,
    messageId: event.message?.id || event.messageId || event.id || null,
    itemId: event.message?.id || event.messageId || event.id || null,
    kind: 'agent_message',
    phase: 'commentary',
    status: 'running',
    label: content,
    content,
    timestamp: event.message?.timestamp || event.timestamp || legacyPayload.timestamp
  };
}

export function applySyncSocketPayload(payload, context) {
  if (payload?.type === 'sync-state') {
    applyRuntimeStateFromSnapshot(payload.state, context);
    return true;
  }
  if (payload?.type !== 'sync-event' || !payload.event) {
    return false;
  }

  const { event } = payload;
  const legacyPayload = syncEventPayloadForLegacy(event);

  if (payload.state) {
    applyRuntimeStateFromSnapshot(payload.state, context);
  }

  if (isSyncRunningEvent(event)) {
    context.markRun(legacyPayload);
    context.setThreadRuntimeById((current) => applySyncRuntimeEvent(current, event));
    return true;
  }

  if (isSyncTerminalEvent(event)) {
    context.markSessionCompleteNotice(legacyPayload);
    clearRuntimeForEvent(event, context);
    if (syncEventMatchesCurrent(event, context.selectedSessionRef)) {
      if (event.eventType === 'turn.failed') {
        context.setMessages((current) =>
          upsertStatusMessage(current, {
            ...legacyPayload,
            kind: 'turn',
            status: 'failed',
            label: '任务失败',
            detail: event.detail || '任务失败'
          })
        );
      } else if (event.eventType === 'turn.aborted') {
        context.setMessages((current) =>
          upsertStatusMessage(current, {
            ...legacyPayload,
            kind: 'turn',
            status: 'completed',
            label: '已中止'
          })
        );
      } else if (event.sessionId || event.turnId) {
        context.scheduleTurnRefresh(legacyPayload);
      }
    }
    return true;
  }

  if (event.eventType === 'desktop.sync.status') {
    if (syncEventMatchesCurrent(event, context.selectedSessionRef)) {
      context.setMessages((current) =>
        upsertStatusMessage(current, {
          ...legacyPayload,
          kind: 'turn',
          status: desktopSyncMessageStatus(event.status),
          label: desktopSyncLabel(event.status, event.detail),
          detail: event.detail || ''
        })
      );
    }
    return true;
  }

  if (event.eventType === 'thread.started' && event.sessionId) {
    const projectId = event.projectId || context.selectedProjectRef?.current?.id || context.selectedSessionRef.current?.projectId;
    const currentSession = context.selectedSessionRef.current;
    const nextSession = {
      ...(currentSession || {}),
      ...(event.session || {}),
      id: event.sessionId,
      projectId,
      title: event.session?.title || currentSession?.title || '新对话',
      turnId: event.turnId || currentSession?.turnId || null,
      updatedAt: event.timestamp || new Date().toISOString(),
      draft: false
    };
    const shouldPromote = shouldPromoteCurrentDraftToThread(currentSession, event, projectId);
    if (shouldPromote) {
      context.selectedSessionRef.current = nextSession;
      context.setSelectedSession?.((current) => (current ? { ...current, ...nextSession } : nextSession));
    }
    const rekeySources = new Set(
      [event.previousSessionId, event.draftSessionId, shouldPromote ? currentSession?.id : null]
        .filter(Boolean)
        .map(String)
    );
    for (const sourceKey of rekeySources) {
      context.moveComposerDraftState?.(sourceKey, String(event.sessionId));
    }
    if (projectId && context.upsertSessionInProject) {
      context.setSessionsByProject?.((current) =>
        context.upsertSessionInProject(current, projectId, nextSession, event.previousSessionId)
      );
    }
    if (shouldPromote) {
      context.setMessages?.((current) =>
        current.map((message) =>
          message.turnId === event.turnId || message.sessionId === event.previousSessionId
            ? { ...message, sessionId: event.sessionId }
            : message
        )
      );
    }
    return true;
  }

  if (event.eventType === 'message.user' && event.message && syncEventMatchesCurrent(event, context.selectedSessionRef)) {
    context.setMessages((current) => reconcileOrAppendCurrentUserMessage(current, event));
    context.scheduleTurnRefresh?.({
      ...legacyPayload,
      sessionId: event.message.sessionId || event.sessionId || null,
      turnId: event.message.turnId || event.turnId || event.clientTurnId || null
    });
    return true;
  }

  if (event.eventType === 'message.user' && event.message) {
    updateSessionPreviewForEvent(event, context);
    return true;
  }

  if (event.eventType === 'message.deleted' && event.messageId && syncEventMatchesCurrent(event, context.selectedSessionRef)) {
    context.setMessages((current) => current.filter((message) => String(message.id) !== String(event.messageId)));
    return true;
  }

  if (event.eventType?.startsWith('message.assistant') && event.message && syncEventMatchesCurrent(event, context.selectedSessionRef)) {
    if (String(event.message.content || '').trim()) {
      if (isCommentaryAssistantMessage(event)) {
        context.setMessages((current) => upsertActivityMessage(
          removeAssistantMessageCoveredByProcessText(current, commentaryDescriptorFromAssistantEvent(event)),
          commentaryActivityPayload(event, legacyPayload)
        ));
      } else {
        context.setMessages((current) => upsertAssistantMessage(current, {
          ...legacyPayload,
          ...event.message,
          content: event.message.content,
          done: event.message.done
        }));
        if (event.eventType === 'message.assistant.completed') {
          context.scheduleTurnRefresh?.({
            ...legacyPayload,
            sessionId: event.message.sessionId || event.sessionId || null,
            turnId: event.message.turnId || event.turnId || event.clientTurnId || null
          });
        }
      }
    }
    return true;
  }

  if (event.eventType?.startsWith('message.assistant') && event.message) {
    updateSessionPreviewFromAssistantEvent(event, context);
    return true;
  }

  if (event.eventType?.startsWith('activity.') && event.activity && !event.suppressedInChat && syncEventMatchesCurrent(event, context.selectedSessionRef)) {
    context.setMessages((current) => upsertActivityMessage(
      isCommentaryActivity(event)
        ? removeAssistantMessageCoveredByProcessText(current, commentaryDescriptorFromActivityEvent(event))
        : current,
      event.activity
    ));
    return true;
  }

  if (event.eventType === 'interaction.requested' && event.interaction && syncEventMatchesCurrent(event, context.selectedSessionRef)) {
    context.setMessages((current) => upsertInteractionRequestMessage(current, event));
    return true;
  }

  if (event.eventType === 'interaction.resolved' && syncEventMatchesCurrent(event, context.selectedSessionRef)) {
    context.setMessages((current) => resolveInteractionRequestMessage(current, event));
    return true;
  }

  if (event.eventType === 'context.updated' && event.context && syncEventMatchesCurrent(event, context.selectedSessionRef)) {
    const applyContextUpdate = context.setLiveContextStatus || context.setContextStatus;
    applyContextUpdate?.((current) => mergeContextStatus(current, event.context, context.defaultStatus.context));
    return true;
  }

  if (event.eventType === 'sessions.synced') {
    if (Array.isArray(event.projects)) {
      context.setProjects(event.projects);
    }
    return true;
  }

  if (event.eventType === 'thread.renamed') {
    context.handleThreadRenamed?.(event);
    return true;
  }

  return true;
}

export function syncEventHasRunKeys(event = {}) {
  return syncEventRunKeys(event).length > 0;
}
