/**
 * 聊天消息渲染队列：把运行中步骤投影为实时进度，并把完成后的执行记录归档成摘要。
 *
 * Keywords: chat render, activity files, process stream, message order
 *
 * Exports:
 * - chatRenderItems — 生成 ChatPane 可直接渲染的消息、实时进度与文件卡片条目。
 * - fileSummaryForActivityMessage — 从单条 activity 消息提取完成后的文件汇总。
 *
 * Inward: activity-card-state、activity-model、activity-timeline-projection。
 *
 * Outward: ChatPane.jsx、chat-render-items.test.mjs。
 */

import { activityMessageIsRunning, effectiveActivityMessageIsRunning } from './activity-card-state.js';
import {
  isVisibleActivityStep,
  mergeActivityMessages,
  shouldRenderActivityMessageInChat
} from './activity-model.js';
import { projectActivityView } from './activity-timeline-projection.js';

function messageTimestampMs(message = {}) {
  const time = new Date(message?.timestamp || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function assistantDedupKey(message = {}) {
  if (message?.role !== 'assistant') {
    return '';
  }
  const turnId = String(message.turnId || '').trim();
  const sessionId = String(message.sessionId || '').trim();
  if (!turnId) {
    return '';
  }
  return `${sessionId}:${turnId}`;
}

function userDedupKey(message = {}) {
  if (message?.role !== 'user') {
    return '';
  }
  const turnId = String(message.turnId || '').trim();
  const sessionId = String(message.sessionId || '').trim();
  const content = String(message.content || '').trim();
  if (!turnId || !content) {
    return '';
  }
  return `${sessionId}:${turnId}:${content}`;
}

function preferredAssistantMessage(current, candidate) {
  if (!current) {
    return candidate;
  }
  if (Boolean(candidate?.streaming) !== Boolean(current?.streaming)) {
    return candidate?.streaming ? candidate : current;
  }
  const currentLength = String(current?.content || '').length;
  const candidateLength = String(candidate?.content || '').length;
  if (candidateLength !== currentLength) {
    return candidateLength > currentLength ? candidate : current;
  }
  return messageTimestampMs(candidate) >= messageTimestampMs(current) ? candidate : current;
}

function preferredUserMessage(current, candidate) {
  if (!current) {
    return candidate;
  }
  const currentPending = current?.deliveryState === 'pending';
  const candidatePending = candidate?.deliveryState === 'pending';
  if (currentPending !== candidatePending) {
    return candidatePending ? current : candidate;
  }
  return messageTimestampMs(candidate) >= messageTimestampMs(current) ? candidate : current;
}

function normalizeVisibleMessages(messages = []) {
  const assistantByKey = new Map();
  const userByKey = new Map();
  return messages.reduce((result, message) => {
    const assistantKey = assistantDedupKey(message);
    if (assistantKey) {
      const previous = assistantByKey.get(assistantKey);
      const preferred = preferredAssistantMessage(previous, message);
      assistantByKey.set(assistantKey, preferred);
      if (!previous) {
        result.push(message);
        return result;
      }
      return result.map((item) => (item === previous ? preferred : item));
    }

    const userKey = userDedupKey(message);
    if (userKey) {
      const previous = userByKey.get(userKey);
      const preferred = preferredUserMessage(previous, message);
      userByKey.set(userKey, preferred);
      if (!previous) {
        result.push(message);
        return result;
      }
      return result.map((item) => (item === previous ? preferred : item));
    }

    result.push(message);
    return result;
  }, []);
}

export function fileSummaryForActivityMessage(message, { forceRunning = false } = {}) {
  if (message?.role !== 'activity' || !shouldRenderActivityMessageInChat(message)) {
    return null;
  }
  const activities = message.activities || [];
  const running = effectiveActivityMessageIsRunning({ message, activities, forceRunning });
  if (running) {
    return null;
  }
  const visibleSteps = activities.filter((activity) => isVisibleActivityStep(activity, message.status));
  return projectActivityView(visibleSteps, { running }).fileSummary;
}

function latestUserIndex(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user' && !message.guided && message.kind !== 'guided_user') {
      return index;
    }
  }
  return 0;
}

function latestAssistantIndex(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') {
      return index;
    }
  }
  return -1;
}

export function chatRenderItems(messages = [], { running = false } = {}) {
  const sourceMessages = normalizeVisibleMessages(Array.isArray(messages) ? messages : []);
  const streamingAssistantTurnIds = new Set(
    sourceMessages
      .filter((message) => message?.role === 'assistant' && message?.streaming)
      .map((message) => String(message.turnId || '').trim())
      .filter(Boolean)
  );
  const latestUser = latestUserIndex(sourceMessages);
  const latestAssistant = latestAssistantIndex(sourceMessages);
  const liveStartIndex = running
    ? Math.max(latestAssistant, latestUser - 1)
    : Number.POSITIVE_INFINITY;
  const items = [];
  const pendingByTurn = new Map();
  let pendingActivityMessage = null;
  let pendingLiveActivity = null;

  const queueFileSummary = (message) => {
    const summary = fileSummaryForActivityMessage(message);
    if (!summary) {
      return;
    }
    const key = activityResultKey(message);
    const entry = {
      type: 'fileSummary',
      key: `file-summary-${message.id}`,
      summary
    };
    if (!key) {
      items.push(entry);
      return;
    }
    pendingByTurn.set(key, [...(pendingByTurn.get(key) || []), entry]);
  };

  const flushFileSummaries = (message, item) => {
    for (const key of pendingResultKeysForMessage(message, pendingByTurn)) {
      const pending = pendingByTurn.get(key);
      if (!pending?.length) {
        continue;
      }
      item.fileSummaries = [...(item.fileSummaries || []), ...pending.map((entry) => entry.summary)];
      pendingByTurn.delete(key);
    }
  };

  const flushPendingActivity = () => {
    if (!pendingActivityMessage) {
      return;
    }
    const item = {
      type: 'message',
      key: pendingActivityMessage.id || `${items.length}`,
      message: pendingActivityMessage
    };
    const assistantIndex = matchingAssistantItemIndex(items, pendingActivityMessage);
    if (assistantIndex >= 0) {
      items.splice(assistantIndex, 0, item);
      const summary = fileSummaryForActivityMessage(pendingActivityMessage);
      if (summary) {
        const assistantItem = items[assistantIndex + 1];
        assistantItem.fileSummaries = [...(assistantItem.fileSummaries || []), summary];
      }
      pendingActivityMessage = null;
      return;
    }
    items.push(item);
    queueFileSummary(pendingActivityMessage);
    pendingActivityMessage = null;
  };

  const flushPendingLive = () => {
    if (!pendingLiveActivity) {
      return;
    }
    items.push({
      type: 'liveActivity',
      key: liveActivityItemKey(pendingLiveActivity, items.length),
      message: pendingLiveActivity
    });
    pendingLiveActivity = null;
  };

  for (let index = 0; index < sourceMessages.length; index += 1) {
    const message = sourceMessages[index];
    const messageTurnId = String(message?.turnId || '').trim();
    const hideActivityDuringAssistantStream =
      message?.role === 'activity' &&
      messageTurnId &&
      streamingAssistantTurnIds.has(messageTurnId);
    if (hideActivityDuringAssistantStream) {
      continue;
    }
    const runningActivity = message?.role === 'activity' && activityMessageIsRunning(message);
    const currentRuntimeActivity = message?.role === 'activity' && !message.forceTimeline && (runningActivity || (running && index > liveStartIndex));
    if (currentRuntimeActivity) {
      if (pendingActivityMessage) {
        pendingLiveActivity = pendingLiveActivity
          ? mergeActivityMessages(pendingLiveActivity, pendingActivityMessage)
          : pendingActivityMessage;
        pendingActivityMessage = null;
      }
      pendingLiveActivity = pendingLiveActivity
        ? mergeActivityMessages(pendingLiveActivity, message)
        : message;
      continue;
    }
    if (message?.role === 'activity') {
      pendingActivityMessage = pendingActivityMessage
        ? mergeActivityMessages(pendingActivityMessage, message)
        : message;
      continue;
    }
    flushPendingActivity();
    if (!running) {
      flushPendingLive();
    }
    const item = { type: 'message', key: message.id || `${items.length}`, message };
    items.push(item);
    if (message?.role === 'assistant') {
      flushFileSummaries(message, item);
    }
  }
  flushPendingActivity();
  flushPendingLive();

  return items;
}

function activityResultKey(message = {}) {
  const turnId = String(message.turnId || '').trim();
  if (!turnId) {
    return '';
  }
  return `${turnId}:${numericSegmentIndex(message.segmentIndex) ?? 0}`;
}

function liveActivityItemKey(message = {}, fallback = '') {
  const key = message.turnId || message.clientTurnId || message.sessionId || message.id || fallback;
  return `live-activity-${key}`;
}

function resultKeysForMessage(message = {}) {
  const turnId = String(message.turnId || '').trim();
  if (!turnId) {
    return [];
  }
  const segmentIndex = numericSegmentIndex(message.segmentIndex);
  return segmentIndex === null ? [`${turnId}:0`] : [`${turnId}:${segmentIndex}`, `${turnId}:0`];
}

function pendingResultKeysForMessage(message = {}, pendingByTurn = new Map()) {
  const keys = resultKeysForMessage(message);
  const turnId = String(message.turnId || '').trim();
  if (message?.role === 'assistant' && turnId && numericSegmentIndex(message.segmentIndex) === null) {
    for (const key of pendingByTurn.keys()) {
      if (key.startsWith(`${turnId}:`)) {
        keys.push(key);
      }
    }
  }
  return [...new Set(keys)];
}

function matchingAssistantItemIndex(items = [], activityMessage = {}) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type === 'message' && item.message?.role === 'assistant' && messagesShareResultTurn(activityMessage, item.message)) {
      return index;
    }
  }
  return -1;
}

function messagesShareResultTurn(left = {}, right = {}) {
  const leftTurnId = String(left.turnId || '').trim();
  const rightTurnId = String(right.turnId || '').trim();
  if (!leftTurnId || leftTurnId !== rightTurnId) {
    return false;
  }
  const leftSegment = numericSegmentIndex(left.segmentIndex);
  const rightSegment = numericSegmentIndex(right.segmentIndex);
  return leftSegment === null || rightSegment === null || leftSegment === rightSegment;
}

function numericSegmentIndex(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
