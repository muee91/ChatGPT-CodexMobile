/**
 * 选中会话的消息补账合并与项目名称同步。
 *
 * Keywords: session, live-refresh, polling, merge-messages
 *
 * Exports:
 * - mergeLiveSelectedThreadMessages — 合并本地与已加载消息。
 * - applySessionRenameToProjectSessions — 重命名写回 projects map。
 *
 * Inward: chat/activity-model。
 *
 * Outward: App 选中会话刷新、WebSocket 与轮询协调。
 */

import { coalesceActivityMessages } from './chat/activity-model.js';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function messageRunKeys(message) {
  const specific = [message?.turnId, message?.clientTurnId].filter(Boolean).map(String);
  if (specific.length) {
    return specific;
  }
  return [message?.previousSessionId, message?.sessionId].filter(Boolean).map(String);
}

function isTransientActivityMessage(message) {
  return message?.role === 'activity' && Boolean(message?.transient);
}

function messageTime(message) {
  const time = new Date(message?.completedAt || message?.timestamp || message?.startedAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function loadedHasAssistantForActivity(loaded, activity) {
  const keys = new Set(messageRunKeys(activity));
  if (!keys.size) {
    return false;
  }
  return loaded.some((item) => item?.role === 'assistant' && messageMatchesRunKeys(item, keys) && normalizeText(item.content));
}

function loadedHasTerminalAssistantAfterActivity(loaded, activity) {
  const activityTime = messageTime(activity);
  return loaded.some((item) =>
    item?.role === 'assistant' &&
    normalizeText(item.content) &&
    (!activityTime || messageTime(item) >= activityTime)
  );
}

export function hasStaleRunningActivityResolvedByLoaded(current = [], loaded = []) {
  if (!Array.isArray(current) || !Array.isArray(loaded)) {
    return false;
  }
  return current.some((message) =>
    message?.role === 'activity' &&
    ['running', 'queued'].includes(String(message?.status || '')) &&
    loadedHasTerminalAssistantAfterActivity(loaded, message)
  );
}

function messageMatchesRunKeys(message, keys) {
  if (!keys.size) {
    return false;
  }
  return messageRunKeys(message).some((key) => keys.has(key));
}

function completeLocalActivityMessage(message, loaded = []) {
  const keys = new Set(messageRunKeys(message));
  const assistant = loaded.find((item) => item?.role === 'assistant' && messageMatchesRunKeys(item, keys) && normalizeText(item.content));
  if (!assistant && !['running', 'queued'].includes(String(message?.status || ''))) {
    return message;
  }
  if (!assistant && ['running', 'queued'].includes(String(message?.status || ''))) {
    return message;
  }
  return {
    ...message,
    status: message.status === 'failed' ? 'failed' : 'completed',
    label: message.status === 'failed' ? message.label : '过程已同步',
    content: message.status === 'failed' ? message.content : '过程已同步',
    completedAt: message.completedAt || assistant?.timestamp || new Date().toISOString(),
    activities: Array.isArray(message.activities)
      ? message.activities.map((activity) =>
        ['running', 'queued'].includes(String(activity?.status || ''))
          ? { ...activity, status: 'completed' }
          : activity
      )
      : message.activities
  };
}

function activityInsertIndex(loaded, activity) {
  const keys = new Set(messageRunKeys(activity));
  const index = loaded.findIndex((message) => message?.role === 'assistant' && messageMatchesRunKeys(message, keys));
  return index >= 0 ? index : loaded.length;
}

function preserveLocalActivityMessages(current = [], loaded = [], { forceDropStaleRunning = false } = {}) {
  const loadedIds = new Set(loaded.map((message) => String(message?.id || '')).filter(Boolean));
  const preserved = current
    .filter((message) => message?.role === 'activity' && !loadedIds.has(String(message?.id || '')))
    .filter((message) => {
      const keys = new Set(messageRunKeys(message));
      if (!keys.size) {
        return false;
      }
      if (loaded.some((item) => item?.role === 'activity' && messageMatchesRunKeys(item, keys))) {
        return false;
      }
      if (isTransientActivityMessage(message) && loadedHasAssistantForActivity(loaded, message)) {
        return false;
      }
      if (
        forceDropStaleRunning &&
        ['running', 'queued'].includes(String(message?.status || '')) &&
        loadedHasTerminalAssistantAfterActivity(loaded, message)
      ) {
        return false;
      }
      return loaded.some((item) => messageMatchesRunKeys(item, keys)) || ['running', 'queued'].includes(String(message?.status || ''));
    })
    .map((message) =>
      isTransientActivityMessage(message)
        ? message
        : completeLocalActivityMessage(message, loaded)
    );

  if (!preserved.length) {
    return coalesceActivityMessages(loaded);
  }

  const result = [...loaded];
  for (const activity of preserved.sort((a, b) => activityInsertIndex(result, a) - activityInsertIndex(result, b))) {
    result.splice(activityInsertIndex(result, activity), 0, activity);
  }
  return coalesceActivityMessages(result);
}

export function mergeLiveSelectedThreadMessages(current = [], loaded = [], options = {}) {
  if (!Array.isArray(loaded)) {
    return Array.isArray(current) ? current : [];
  }
  if (!Array.isArray(current) || !current.length) {
    return coalesceActivityMessages(loaded);
  }
  return preserveLocalActivityMessages(current, loaded, options);
}

export function applySessionRenameToProjectSessions(current = {}, payload = {}) {
  const projectId = payload.projectId || payload.session?.projectId || '';
  const sessionId = payload.sessionId || payload.session?.id || '';
  const title = normalizeText(payload.title || payload.session?.title);
  if (!projectId || !sessionId || !title) {
    return current;
  }

  const existing = Array.isArray(current[projectId]) ? current[projectId] : [];
  const sessionPatch = {
    ...(payload.session || {}),
    id: sessionId,
    projectId,
    title,
    titleLocked: payload.titleLocked ?? payload.session?.titleLocked ?? true
  };
  if (payload.updatedAt || payload.session?.updatedAt) {
    sessionPatch.updatedAt = payload.updatedAt || payload.session.updatedAt;
  }

  let found = false;
  const nextSessions = existing.map((session) => {
    if (String(session?.id || '') !== String(sessionId)) {
      return session;
    }
    found = true;
    return { ...session, ...sessionPatch };
  });

  if (!found && payload.session) {
    nextSessions.unshift(sessionPatch);
  }

  if (!found && !payload.session) {
    return current;
  }

  return {
    ...current,
    [projectId]: nextSessions
  };
}
