/**
 * 回合运行期副作用：只响应统一 sync runtime，维护运行态清理与完成后消息补账。
 *
 * Keywords: turn-runtime, sync-runtime, activity-merge, running-keys
 *
 * Exports:
 * - `runtimeKeysForPayload` / `completeMessagesForTurnCompletion` — payload 与会话对齐、轮次完成时的消息补齐。
 * - `useTurnRuntime` — 订阅运行中 turn 的状态更新与消息合并的 hook。
 *
 * Inward: `api`、`activity-model`、`context-status`、`session-utils`、`runtime-debug-client`。
 *
 * Outward: `App.jsx` 编排会话与聊天数据流。
 */

import { useEffect } from 'react';
import { apiFetch } from '../api.js';
import {
  completeActivityMessagesForTurn,
  hasAssistantMessageForTurn,
  mergeLoadedMessagesPreservingActivity,
  upsertStatusMessage
} from '../chat/activity-model.js';
import { mergeContextStatus } from './context-status.js';
import {
  hasVisibleAssistantForTurn,
  hasVisibleUserForTurn,
  isDraftSession,
  payloadRunKeys,
  sessionMessagesApiPath
} from './session-utils.js';
import { clientRuntimeDebug } from './runtime-debug-client.js';

export function visibleAssistantTextForPayload(messages = [], payload = {}) {
  if (!Array.isArray(messages) || !messages.length) {
    return '';
  }
  const hasExplicitTurn = Boolean(payload?.turnId || payload?.clientTurnId);
  const exactTurnMatch = messages.find((message) =>
    message?.role === 'assistant' &&
    ((payload?.turnId && message.turnId === payload.turnId) ||
      (payload?.clientTurnId && message.turnId === payload.clientTurnId)) &&
    typeof message.content === 'string' &&
    message.content.trim()
  );
  if (exactTurnMatch) {
    return String(exactTurnMatch.content || '');
  }
  if (hasExplicitTurn) {
    return '';
  }
  const latestUserIndex = messages.reduce(
    (latest, message, index) => (message?.role === 'user' ? index : latest),
    -1
  );
  const fallback = messages.find((message, index) =>
    message?.role === 'assistant' &&
    index > latestUserIndex &&
    typeof message.content === 'string' &&
    message.content.trim()
  );
  return String(fallback?.content || '');
}

export function loadedMessagesShouldReplaceCurrent(current = [], loaded = [], payload = {}) {
  if (!Array.isArray(loaded) || !loaded.length) {
    return false;
  }
  const currentAssistant = visibleAssistantTextForPayload(current, payload);
  const loadedAssistant = visibleAssistantTextForPayload(loaded, payload);
  if (!loadedAssistant.trim()) {
    return false;
  }
  if (!currentAssistant.trim()) {
    return true;
  }
  return loadedAssistant.length >= currentAssistant.length;
}

export function runtimeKeysForPayload(payload, currentSession = null) {
  const keys = new Set(payloadRunKeys(payload));
  if (currentSession) {
    const sameProject = !payload?.projectId || !currentSession.projectId || payload.projectId === currentSession.projectId;
    const matchesCurrent =
      keys.has(currentSession.id) ||
      keys.has(currentSession.turnId) ||
      (payload?.turnId && currentSession.turnId === payload.turnId) ||
      (currentSession.draft && sameProject);
    if (matchesCurrent) {
      if (currentSession.id) {
        keys.add(currentSession.id);
      }
      if (currentSession.turnId) {
        keys.add(currentSession.turnId);
      }
    }
  }
  return Array.from(keys).filter(Boolean);
}

export function completeMessagesForTurnCompletion(current, payload, detail = '结果同步中') {
  const completedAt = payload?.completedAt || payload?.timestamp || new Date().toISOString();
  const completedPayload = { ...payload, completedAt };
  const messagesWithCompletedActivity = completeActivityMessagesForTurn(current, completedPayload);
  if (hasAssistantMessageForTurn(current, payload)) {
    return messagesWithCompletedActivity;
  }
  void detail;
  return messagesWithCompletedActivity;
}

export function useTurnRuntime({
  defaultStatus,
  turnRefreshTimersRef,
  selectedSessionRef,
  messagesRef,
  runningByIdRef,
  setRunningById,
  setThreadRuntimeById,
  setCompletedSessionIds,
  setMessages,
  setContextStatus
}) {
  useEffect(
    () => () => {
      for (const timer of turnRefreshTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      turnRefreshTimersRef.current.clear();
    },
    [turnRefreshTimersRef]
  );

  function runtimeKeysForCurrentPayload(payload) {
    return runtimeKeysForPayload(payload, selectedSessionRef.current);
  }

  function markRun(payload) {
    const keys = runtimeKeysForCurrentPayload(payload);
    if (!keys.length) {
      return;
    }
    const now = new Date().toISOString();
    const status = String(payload.status || '').toLowerCase() === 'queued' ? 'queued' : 'running';
    const updatedAt = payload.timestamp || payload.startedAt || now;
    setRunningById((current) => {
      const next = { ...current };
      for (const key of keys) {
        next[key] = true;
      }
      runningByIdRef.current = next;
      return next;
    });
    setThreadRuntimeById((current) => {
      const next = { ...current };
      for (const key of keys) {
        const previous = next[key];
        const startedAt = runtimeStartedAtForMark(previous, payload, status, updatedAt);
        next[key] = {
          ...previous,
          status,
          steerable: payload.steerable !== false,
          startedAt,
          updatedAt,
          source: payload.source || previous?.source || null,
          sessionId: payload.sessionId || previous?.sessionId || null,
          previousSessionId: payload.previousSessionId || previous?.previousSessionId || null,
          turnId: payload.turnId || payload.clientTurnId || previous?.turnId || null,
          clientTurnId: payload.clientTurnId || previous?.clientTurnId || null,
          label: payload.label || previous?.label || null,
          detail: payload.detail || previous?.detail || null
        };
      }
      return next;
    });
    clientRuntimeDebug('markRun', {
      keys,
      source: payload.source || null,
      sessionId: payload.sessionId || null,
      turnId: payload.turnId || payload.clientTurnId || null
    });
  }

  function clearRun(payload) {
    const keys = runtimeKeysForCurrentPayload(payload);
    if (!keys.length) {
      return;
    }
    setRunningById((current) => {
      const next = { ...current };
      for (const key of keys) {
        delete next[key];
      }
      runningByIdRef.current = next;
      return next;
    });
    setThreadRuntimeById((current) => {
      const next = { ...current };
      for (const key of keys) {
        if (next[key]?.status === 'running' || next[key]?.status === 'queued') {
          delete next[key];
        }
      }
      return next;
    });
    clientRuntimeDebug('clearRun', {
      keys,
      source: payload.source || null,
      sessionId: payload.sessionId || null,
      turnId: payload.turnId || payload.clientTurnId || null
    });
  }

  function markSessionCompleteNotice(payload) {
    const ids = runtimeKeysForCurrentPayload(payload).filter((id) => !isDraftSession(id));
    if (!ids.length) {
      return;
    }
    setCompletedSessionIds((current) => {
      const next = { ...current };
      for (const id of ids) {
        next[id] = true;
      }
      return next;
    });
    setThreadRuntimeById((current) => {
      const next = { ...current };
      for (const id of ids) {
        next[id] = {
          status: 'completed',
          updatedAt: payload.completedAt || payload.timestamp || new Date().toISOString()
        };
      }
      return next;
    });
  }

  function clearSessionCompleteNotice(sessionId) {
    if (!sessionId) {
      return;
    }
    setCompletedSessionIds((current) => {
      if (!current[sessionId]) {
        return current;
      }
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    setThreadRuntimeById((current) => {
      if (current[sessionId]?.status !== 'completed') {
        return current;
      }
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }

  function payloadMatchesCurrentConversation(payload) {
    const current = selectedSessionRef.current;
    if (!current) {
      return true;
    }
    const keys = payloadRunKeys(payload);
    return keys.includes(current.id) || keys.includes(current.turnId);
  }

  function clearTurnRefreshTimer(turnId) {
    if (!turnId) {
      return;
    }
    const timer = turnRefreshTimersRef.current.get(turnId);
    if (timer) {
      window.clearTimeout(timer);
      turnRefreshTimersRef.current.delete(turnId);
    }
  }

  async function refreshMessagesForPayload(payload) {
    if (!payload?.sessionId || !payloadMatchesCurrentConversation(payload)) {
      return false;
    }
    try {
      const data = await apiFetch(sessionMessagesApiPath(payload.sessionId));
      if (
        data.messages?.length &&
        (hasVisibleAssistantForTurn(data.messages, payload) || hasVisibleUserForTurn(data.messages, payload))
      ) {
        const currentMessages = Array.isArray(messagesRef?.current) ? messagesRef.current : [];
        if (!loadedMessagesShouldReplaceCurrent(currentMessages, data.messages, payload)) {
          return false;
        }
        setContextStatus((current) => mergeContextStatus(current, data.context || defaultStatus.context, defaultStatus.context));
        setMessages((current) => mergeLoadedMessagesPreservingActivity(current, data.messages, payload));
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  function finalizeTurnWithoutAssistant(payload) {
    if (!payload?.turnId) {
      return;
    }
    clearTurnRefreshTimer(payload.turnId);
    setMessages((current) =>
      upsertStatusMessage(current, {
        ...payload,
        status: 'completed',
        label: '任务已完成',
        detail: payload.error || payload.detail || ''
      })
    );
    clearRun(payload);
  }

  function markTurnCompleted(payload, detail = '结果同步中') {
    if (!payload?.turnId) {
      return;
    }
    const completedAt = payload.completedAt || payload.timestamp || new Date().toISOString();
    clearRun({ ...payload, completedAt });
    markSessionCompleteNotice({ ...payload, completedAt });
    setMessages((current) => completeMessagesForTurnCompletion(current, { ...payload, completedAt }, detail));
  }

  function scheduleTurnRefresh(payload, attempt = 0) {
    const turnId = payload?.turnId;
    if (!turnId || !payload?.sessionId || !payloadMatchesCurrentConversation(payload)) {
      return;
    }
    clearTurnRefreshTimer(turnId);
    const delays = [300, 800, 1500, 2500, 4000, 6500, 10000, 15000, 22000, 30000, 30000];
    const delay = delays[attempt];
    if (delay === undefined) {
      finalizeTurnWithoutAssistant(payload);
      return;
    }

    const timer = window.setTimeout(async () => {
      if (!payloadMatchesCurrentConversation(payload)) {
        return;
      }
      const loaded = await refreshMessagesForPayload(payload);
      if (loaded) {
        clearTurnRefreshTimer(turnId);
        clearRun(payload);
        return;
      }
      scheduleTurnRefresh(payload, attempt + 1);
    }, delay);
    turnRefreshTimersRef.current.set(turnId, timer);
  }

  return {
    markRun,
    clearRun,
    markSessionCompleteNotice,
    clearSessionCompleteNotice,
    payloadMatchesCurrentConversation,
    markTurnCompleted,
    scheduleTurnRefresh
  };
}

function runtimeStartedAtForMark(previous, payload, status, updatedAt) {
  const incomingStartedAt = payload.startedAt || payload.timestamp || updatedAt;
  const previousStatus = String(previous?.status || '').toLowerCase();
  if (!previous || !['running', 'queued'].includes(previousStatus)) {
    return incomingStartedAt;
  }
  if (previousStatus === 'queued' && status === 'running') {
    return incomingStartedAt;
  }
  return previous.startedAt || incomingStartedAt;
}
