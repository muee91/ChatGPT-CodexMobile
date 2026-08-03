/**
 * 读取 rollout/session JSONL，拼装消息列表、分页与桌面/协作活动投影入口。
 *
 * Keywords: session-messages, rollout-jsonl, pagination, desktop-thread
 *
 * Exports:
 * - messagesFromRolloutJsonl / publicContextState / publicRuntimeState — 解析与脱敏视图。
 * - readRolloutContextState / paginateMessages / isoFromEpochSeconds — IO 与分页工具。
 * - createSessionMessageReader — 可注入 fs 与会话依赖的读数器。
 *
 * Inward（本模块依赖/组装的关键符号）: codex-app-server、desktop-activity-parser、desktop-thread-projector。
 *
 * Outward（谁在用/调用场景）: codex-data.readSessionMessages、API 层。
 *
 * 不负责: 写入会话文件。
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import readline from 'node:readline';
import { readDesktopThread as defaultReadDesktopThread } from './codex-app-server.js';
import {
  readDesktopCollabActivities as defaultReadDesktopCollabActivities,
  readRawSessionActivities as defaultReadRawSessionActivities
} from './desktop-activity-parser.js';
import {
  extractProposedPlanContent,
  implementedPlanContentFromMessage,
  implementedPlanContentsMatch,
  messagesFromDesktopThread as defaultMessagesFromDesktopThread,
  planMessageFromContent,
  planRequestMessageFromContent,
  removeDuplicateGuidedUserSegments,
  removeFallbackActivitiesCoveredByRaw as defaultRemoveFallbackActivitiesCoveredByRaw,
  sanitizeVisibleUserMessage,
  sortDesktopActivitySteps as defaultSortDesktopActivitySteps,
  upsertDesktopActivity as defaultUpsertDesktopActivity
} from './desktop-thread-projector.js';
import {
  filterDeletedMessages as defaultFilterDeletedMessages,
  readDeletedMessageIds as defaultReadDeletedMessageIds
} from './session-local-state.js';

const ROLLOUT_CONTEXT_READ_BYTES = Math.max(
  64 * 1024,
  Number(process.env.CODEXMOBILE_ROLLOUT_CONTEXT_READ_BYTES) || 1024 * 1024
);
const GUIDED_USER_LABEL = '已引导对话';
const OVERLAY_DUPLICATE_WINDOW_MS = 2000;

function guidedUserMetadata(enabled) {
  return enabled
    ? {
      guided: true,
      guideLabel: GUIDED_USER_LABEL,
      kind: 'guided_user'
    }
    : {};
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function epochSecondsFromIso(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms / 1000 : null;
}

function normalizedMessageRole(value) {
  return String(value || '').trim();
}

function normalizedMessageContent(value) {
  return String(value || '').trim();
}

function timestampMsFromIso(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : null;
}

function overlayLikeMessageId(value) {
  const id = String(value || '').trim();
  return id.startsWith('user-') || id.startsWith('overlay-') || id.startsWith('local-');
}

function responseMessageText(content) {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((item) => item?.text || item?.content || '')
    .filter(Boolean)
    .join('')
    .trim();
}

function ensureRolloutTurn(turns, sessionId, timestamp) {
  if (turns.length) {
    return turns.at(-1);
  }
  const turn = {
    id: `${sessionId}-turn-1`,
    startedAt: epochSecondsFromIso(timestamp)
  };
  turns.push(turn);
  return turn;
}

export function messagesFromRolloutJsonl(content, sessionId) {
  const messages = [];
  const turns = [];
  const userCountsByTurn = new Map();
  const lines = String(content || '').split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const timestamp = entry.timestamp || new Date().toISOString();
    if (entry.type === 'turn_context') {
      turns.push({
        id: entry.payload?.turn_id || `${sessionId}-turn-${turns.length + 1}`,
        startedAt: epochSecondsFromIso(timestamp)
      });
      continue;
    }
    if (entry.type !== 'response_item' || entry.payload?.type !== 'message') {
      continue;
    }
    const role = entry.payload.role;
    if (role !== 'user' && role !== 'assistant') {
      continue;
    }
    if (role === 'assistant' && entry.payload.phase === 'commentary') {
      continue;
    }
    const contentText = responseMessageText(entry.payload.content);
    if (!contentText) {
      continue;
    }
    const implementedPlanContent = role === 'user' ? implementedPlanContentFromMessage(contentText) : '';
    if (implementedPlanContent) {
      removeImplementedPlanRequests(messages, implementedPlanContent);
    }
    const turn = ensureRolloutTurn(turns, sessionId, timestamp);
    let userIndex = -1;
    if (role === 'user') {
      userIndex = userCountsByTurn.get(turn.id) || 0;
      userCountsByTurn.set(turn.id, userIndex + 1);
    }
    if (role === 'assistant') {
      const proposedPlan = extractProposedPlanContent(contentText);
      if (proposedPlan) {
        const baseId = entry.payload.id || `${turn.id}-assistant-${messages.length + 1}`;
        const planMessage = planMessageFromContent({
          id: `${baseId}-plan`,
          content: proposedPlan,
          timestamp,
          turnId: turn.id,
          sessionId
        });
        const requestMessage = planRequestMessageFromContent({
          id: `${baseId}-plan-request`,
          requestId: `implement-plan:${turn.id}`,
          content: proposedPlan,
          timestamp,
          turnId: turn.id,
          sessionId
        });
        if (planMessage) {
          messages.push(planMessage);
        }
        if (requestMessage) {
          messages.push(requestMessage);
        }
        continue;
      }
    }
    messages.push({
      id: entry.payload.id || `${turn.id}-${role}-${messages.length + 1}`,
      role,
      content: role === 'user' ? sanitizeVisibleUserMessage(contentText) : contentText,
      ...(role === 'user' ? { segmentIndex: userIndex } : {}),
      ...(role === 'user' ? guidedUserMetadata(userIndex > 0) : {}),
      timestamp,
      turnId: turn.id,
      sessionId
    });
  }

  return { messages: removeStalePlanRequestsAfterUserMessages(removeDuplicateGuidedUserSegments(messages)), turns };
}

function removeStalePlanRequestsAfterUserMessages(messages) {
  return messages.filter((message, index) => {
    if (message?.role !== 'plan_request') {
      return true;
    }
    return !messages.slice(index + 1).some((nextMessage) => nextMessage?.role === 'user');
  });
}

function removeImplementedPlanRequests(messages, implementedPlanContent) {
  const normalizedImplemented = String(implementedPlanContent || '').replace(/\s+/g, ' ').trim();
  if (!normalizedImplemented) {
    return;
  }
  const implementedSet = new Set([normalizedImplemented]);
  if (implementedPlanContentsMatch(implementedSet, '')) {
    const latestRequest = messages
      .map((message, messageIndex) => ({ message, messageIndex }))
      .reverse()
      .find(({ message }) => message.role === 'plan_request' && !message.planImplementation?.completed);
    if (latestRequest) {
      messages.splice(latestRequest.messageIndex, 1);
    }
    return;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === 'plan_request' &&
      implementedPlanContentsMatch(implementedSet, message.planImplementation?.planContent)
    ) {
      messages.splice(index, 1);
    }
  }
}

async function readRolloutThreadFromFile(filePath, sessionId) {
  if (!filePath) {
    return null;
  }
  const content = await fs.readFile(filePath, 'utf8');
  const parsed = messagesFromRolloutJsonl(content, sessionId);
  return {
    id: sessionId,
    path: filePath,
    turns: parsed.turns,
    messages: parsed.messages
  };
}

function activityContainerStatusForRuntime(item = {}, contextState = {}) {
  const runtime = contextState?.runtime || null;
  if (!runtime || !item?.turnId) {
    return '';
  }
  if (runtime.turnId !== item.turnId) {
    return '';
  }
  return runtime.status || '';
}

function desktopThreadHasMessages(thread) {
  if (Array.isArray(thread?.messages) && thread.messages.length > 0) {
    return true;
  }
  return (Array.isArray(thread?.turns) ? thread.turns : []).some((turn) =>
    Array.isArray(turn?.items) && turn.items.length > 0
  );
}

function canFallbackToRollout(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.statusCode === 404
    || error?.method === 'app-server-stdout'
    || message.includes('app-server stdout')
    || message.includes('thread not loaded')
    || message.includes('desktop thread not found');
}

export function publicContextState(state = {}, configContext = {}) {
  const contextWindow = state.contextWindow || configContext.modelContextWindow || null;
  const inputTokens = state.inputTokens || null;
  const autoCompactLimit = configContext.autoCompactTokenLimit || null;
  const percent =
    inputTokens && contextWindow
      ? Math.max(0, Math.min(100, Math.round((inputTokens / contextWindow) * 1000) / 10))
      : null;
  const compactDetected = Boolean(state.autoCompactDetected);
  return {
    sessionId: state.sessionId || null,
    model: state.model || null,
    inputTokens,
    totalTokens: state.totalTokens || null,
    contextWindow,
    percent,
    lastTokenUsage: state.lastTokenUsage || null,
    totalTokenUsage: state.totalTokenUsage || null,
    updatedAt: state.updatedAt || null,
    autoCompact: {
      enabled: Boolean(autoCompactLimit || configContext.autoCompactEnabled),
      tokenLimit: autoCompactLimit,
      detected: compactDetected,
      status: compactDetected ? 'detected' : (autoCompactLimit || configContext.autoCompactEnabled) ? 'watching' : 'unknown',
      lastCompactedAt: state.autoCompactLastAt || null,
      reason: state.autoCompactReason || ''
    }
  };
}

export function publicRuntimeState(runtime = null, sessionId = '') {
  if (runtime?.status !== 'running') {
    return null;
  }
  return {
    status: 'running',
    source: runtime.source || 'desktop-thread',
    sessionId: runtime.sessionId || sessionId || null,
    turnId: runtime.turnId || null,
    startedAt: runtime.startedAt || null,
    updatedAt: runtime.updatedAt || null,
    steerable: runtime.steerable === true
  };
}

function tokenUsageFromPayload(payload) {
  const info = payload?.info && typeof payload.info === 'object' ? payload.info : {};
  const last = info.last_token_usage && typeof info.last_token_usage === 'object' ? info.last_token_usage : {};
  const total = info.total_token_usage && typeof info.total_token_usage === 'object' ? info.total_token_usage : {};
  return {
    inputTokens: positiveNumber(last.input_tokens ?? total.input_tokens),
    totalTokens: positiveNumber(total.total_tokens ?? last.total_tokens),
    contextWindow: positiveNumber(info.model_context_window ?? payload?.model_context_window),
    lastTokenUsage: last,
    totalTokenUsage: total
  };
}

function isoFromEpochValue(value, fallback = null) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(seconds * 1000).toISOString();
  }
  return fallback;
}

function markRuntimeRunning(state, { turnId, timestamp, startedAt = null } = {}) {
  const id = String(turnId || '').trim();
  if (!id) {
    return;
  }
  const startedAtIso = isoFromEpochValue(startedAt, timestamp || new Date().toISOString());
  state.runtime = {
    status: 'running',
    source: 'desktop-thread',
    sessionId: state.sessionId || null,
    turnId: id,
    startedAt: startedAtIso,
    updatedAt: timestamp || startedAtIso || new Date().toISOString(),
    steerable: false
  };
}

function clearRuntimeForTurn(state, turnId) {
  if (!state.runtime) {
    return;
  }
  const id = String(turnId || '').trim();
  if (!id || state.runtime.turnId === id) {
    state.runtime = null;
  }
}

function applyContextEntry(state, entry, sessionId) {
  const payload = entry?.payload || {};
  const timestamp = entry?.timestamp || new Date().toISOString();
  const type = payload.type || '';

  if (entry.type === 'turn_context') {
    markRuntimeRunning(state, { turnId: payload.turn_id, timestamp });
    const summary = String(payload.summary || '').trim();
    if (summary && summary !== 'none') {
      state.autoCompactDetected = true;
      state.autoCompactLastAt = timestamp;
      state.autoCompactReason = '会话已带摘要继续';
    }
    if (payload.model) {
      state.model = payload.model;
    }
    state.updatedAt = timestamp;
    return;
  }

  if (
    entry.type === 'response_item' &&
    payload.type === 'message' &&
    payload.role === 'assistant' &&
    payload.phase !== 'commentary'
  ) {
    clearRuntimeForTurn(state, state.runtime?.turnId);
    state.updatedAt = timestamp;
    return;
  }

  if (entry.type === 'compacted') {
    state.autoCompactDetected = true;
    state.autoCompactLastAt = timestamp;
    state.autoCompactReason = '上下文已自动压缩';
    state.updatedAt = timestamp;
    return;
  }

  if (entry.type !== 'event_msg') {
    return;
  }

  if (type === 'task_started') {
    markRuntimeRunning(state, {
      turnId: payload.turn_id,
      timestamp,
      startedAt: payload.started_at
    });
    state.contextWindow = positiveNumber(payload.model_context_window) || state.contextWindow || null;
    state.updatedAt = timestamp;
    return;
  }

  if (/^task_(complete|failed|aborted|cancelled|canceled)$/.test(type) || /^turn_(complete|failed|aborted|cancelled|canceled)$/.test(type)) {
    clearRuntimeForTurn(state, payload.turn_id);
    state.updatedAt = timestamp;
    return;
  }

  if (type !== 'token_count') {
    return;
  }

  const usage = tokenUsageFromPayload(payload);
  const previousInputTokens = state.inputTokens;
  state.sessionId = sessionId;
  state.inputTokens = usage.inputTokens || state.inputTokens || null;
  state.totalTokens = usage.totalTokens || state.totalTokens || null;
  state.contextWindow = usage.contextWindow || state.contextWindow || null;
  state.lastTokenUsage = usage.lastTokenUsage;
  state.totalTokenUsage = usage.totalTokenUsage;
  state.updatedAt = timestamp;

  if (
    previousInputTokens &&
    usage.inputTokens &&
    previousInputTokens > 20000 &&
    usage.inputTokens < previousInputTokens * 0.62
  ) {
    state.autoCompactDetected = true;
    state.autoCompactLastAt = timestamp;
    state.autoCompactReason = '上下文用量回落';
  }
}

export async function readRolloutContextState(filePath, sessionId) {
  const state = { sessionId, runtime: null };
  if (!filePath) {
    return state;
  }

  let start = 0;
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > ROLLOUT_CONTEXT_READ_BYTES) {
      start = stats.size - ROLLOUT_CONTEXT_READ_BYTES;
    }
  } catch {
    return state;
  }

  const stream = fsSync.createReadStream(filePath, { encoding: 'utf8', start });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      try {
        applyContextEntry(state, JSON.parse(line), sessionId);
      } catch {
        // Skip malformed or partial JSONL rows.
      }
    }
  } catch {
    return state;
  }
  return state;
}

export function paginateMessages(messages, { limit = 120, offset = null, latest = true } = {}) {
  const total = messages.length;
  const count = Number(limit) || 0;
  const hasOffset = offset !== null && offset !== undefined;
  const start = hasOffset
    ? Math.max(0, Number(offset) || 0)
    : latest && count
      ? Math.max(0, total - count)
      : 0;
  const end = count ? start + count : undefined;
  return {
    messages: messages.slice(start, end),
    total,
    offset: start,
    hasMore: end ? end < total : false,
    hasMoreBefore: start > 0
  };
}

function messageTimestampValue(message) {
  const value = Date.parse(message?.timestamp || '');
  return Number.isFinite(value) ? value : 0;
}

function sortMessagesByConversationOrder(messages) {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const leftTurnId = left.message?.turnId || '';
      const rightTurnId = right.message?.turnId || '';
      if (leftTurnId && leftTurnId === rightTurnId) {
        return left.index - right.index;
      }
      const timestampDelta = messageTimestampValue(left.message) - messageTimestampValue(right.message);
      return timestampDelta || left.index - right.index;
    })
    .map((item) => item.message);
}

function messageTurnIds(messages = []) {
  return new Set(
    (Array.isArray(messages) ? messages : [])
      .map((message) => String(message?.turnId || '').trim())
      .filter(Boolean)
  );
}

export function isoFromEpochSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

export function createSessionMessageReader({
  readDeletedMessageIds = defaultReadDeletedMessageIds,
  readDesktopThread = defaultReadDesktopThread,
  messagesFromDesktopThread = defaultMessagesFromDesktopThread,
  readRawSessionActivities = defaultReadRawSessionActivities,
  readDesktopCollabActivities = defaultReadDesktopCollabActivities,
  removeFallbackActivitiesCoveredByRaw = defaultRemoveFallbackActivitiesCoveredByRaw,
  upsertDesktopActivity = defaultUpsertDesktopActivity,
  sortDesktopActivitySteps = defaultSortDesktopActivitySteps,
  filterDeletedMessages = defaultFilterDeletedMessages,
  readRolloutContextState: readRolloutContextStateImpl = readRolloutContextState,
  resolveSessionThread = async () => null,
  getConfigContext = () => ({}),
  readSessionOverlayMessages = async () => []
} = {}) {
  function sameMessage(a, b) {
    if (!a || !b) {
      return false;
    }
    if (a.id && b.id && String(a.id) === String(b.id)) {
      return true;
    }
    const leftRole = normalizedMessageRole(a.role);
    const rightRole = normalizedMessageRole(b.role);
    if (!leftRole || leftRole !== rightRole) {
      return false;
    }
    const leftTurnId = String(a.turnId || '').trim();
    const rightTurnId = String(b.turnId || '').trim();
    const leftContent = normalizedMessageContent(a.content);
    const rightContent = normalizedMessageContent(b.content);
    if (leftTurnId && rightTurnId && leftTurnId === rightTurnId && leftContent && leftContent === rightContent) {
      return true;
    }
    return false;
  }

  function messageTimestampDistanceMs(a, b) {
    const leftMs = timestampMsFromIso(a?.timestamp);
    const rightMs = timestampMsFromIso(b?.timestamp);
    if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.abs(leftMs - rightMs);
  }

  function sameOverlayProjectionMessage(baseMessage, overlayMessage) {
    if (!baseMessage || !overlayMessage) {
      return false;
    }
    const leftRole = normalizedMessageRole(baseMessage.role);
    const rightRole = normalizedMessageRole(overlayMessage.role);
    if (!leftRole || leftRole !== rightRole) {
      return false;
    }
    const leftContent = normalizedMessageContent(baseMessage.content);
    const rightContent = normalizedMessageContent(overlayMessage.content);
    if (!leftContent || leftContent !== rightContent) {
      return false;
    }
    const leftSessionId = String(baseMessage.sessionId || '').trim();
    const rightSessionId = String(overlayMessage.sessionId || '').trim();
    if (leftSessionId && rightSessionId && leftSessionId !== rightSessionId) {
      return false;
    }
    const distance = messageTimestampDistanceMs(baseMessage, overlayMessage);
    if (distance <= OVERLAY_DUPLICATE_WINDOW_MS) {
      return true;
    }
    const baseTimestamp = timestampMsFromIso(baseMessage?.timestamp);
    const overlayTimestamp = timestampMsFromIso(overlayMessage?.timestamp);
    if (
      Number.isFinite(baseTimestamp) &&
      Number.isFinite(overlayTimestamp) &&
      overlayTimestamp <= baseTimestamp &&
      overlayLikeMessageId(overlayMessage?.id)
    ) {
      return true;
    }
    return false;
  }

  function findMergedMessageIndex(merged = [], overlayMessage) {
    let closestIndex = -1;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < merged.length; index += 1) {
      const message = merged[index];
      if (sameMessage(message, overlayMessage)) {
        return index;
      }
      if (!sameOverlayProjectionMessage(message, overlayMessage)) {
        continue;
      }
      const distance = messageTimestampDistanceMs(message, overlayMessage);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }
    return closestIndex;
  }

  function mergeOverlayMessages(baseMessages = [], overlayMessages = [], sessionId = '') {
    const merged = Array.isArray(baseMessages) ? baseMessages.map((message) => ({ ...message })) : [];
    for (const rawMessage of Array.isArray(overlayMessages) ? overlayMessages : []) {
      if (!rawMessage?.role || typeof rawMessage.content !== 'string') {
        continue;
      }
      const nextMessage = {
        ...rawMessage,
        sessionId: rawMessage.sessionId || sessionId || null
      };
      const existingIndex = findMergedMessageIndex(merged, nextMessage);
      if (existingIndex >= 0) {
        merged[existingIndex] = {
          ...nextMessage,
          ...merged[existingIndex],
          deliveryState: merged[existingIndex].deliveryState || nextMessage.deliveryState || null,
          status: merged[existingIndex].status || nextMessage.status || null,
          detail: merged[existingIndex].detail || nextMessage.detail || ''
        };
        continue;
      }
      merged.push(nextMessage);
    }
    return merged;
  }

  async function readThread(sessionId) {
    try {
      const response = await readDesktopThread(sessionId, { includeTurns: true });
      if (response?.thread) {
        if (!desktopThreadHasMessages(response.thread)) {
          const session = await resolveSessionThread(sessionId);
          const filePath = session?.filePath || session?.path || response.thread.path || '';
          const fallbackThread = await readRolloutThreadFromFile(filePath, sessionId).catch(() => null);
          if (fallbackThread && desktopThreadHasMessages(fallbackThread)) {
            return fallbackThread;
          }
        }
        return response.thread;
      }
    } catch (error) {
      if (!canFallbackToRollout(error)) {
        throw error;
      }
    }

    const session = await resolveSessionThread(sessionId);
    const filePath = session?.filePath || session?.path || '';
    const thread = await readRolloutThreadFromFile(filePath, sessionId).catch(() => null);
    if (thread) {
      return thread;
    }
    const error = new Error('Desktop thread not found');
    error.statusCode = 404;
    throw error;
  }

  async function readSessionMessages(
    sessionId,
    { limit = 120, offset = null, latest = true, includeActivity = false } = {}
  ) {
    const deletedIds = await readDeletedMessageIds(sessionId);
    const thread = await readThread(sessionId);
    const overlayMessages = await readSessionOverlayMessages(sessionId);

    const baseMessages = Array.isArray(thread.messages)
      ? thread.messages.map((message) => ({ ...message }))
      : messagesFromDesktopThread(thread, { includeActivity: false });
    const mergedBaseMessages = mergeOverlayMessages(baseMessages, overlayMessages, thread.id || sessionId);
    const contextState = await readRolloutContextStateImpl(thread.path, sessionId);
    const orderedBaseMessages = sortMessagesByConversationOrder(filterDeletedMessages(mergedBaseMessages, deletedIds));
    const page = paginateMessages(orderedBaseMessages, { limit, offset, latest });

    let messages = page.messages.map((message) => ({ ...message }));
    if (includeActivity) {
      const visibleTurnIds = messageTurnIds(messages);
      if (contextState?.runtime?.turnId) {
        visibleTurnIds.add(String(contextState.runtime.turnId));
      }
      if (!Array.isArray(thread.messages) && visibleTurnIds.size) {
        const activityMessages = messagesFromDesktopThread(thread, { includeActivity: true, turnIds: visibleTurnIds })
          .filter((message) => message?.role === 'activity');
        messages.push(...activityMessages);
      }
      const activityOptions = visibleTurnIds.size ? { turnIds: visibleTurnIds } : {};
      const rawActivities = await readRawSessionActivities(thread.path, thread.turns || [], activityOptions);
      removeFallbackActivitiesCoveredByRaw(messages, rawActivities);
      for (const item of rawActivities) {
        upsertDesktopActivity(
          messages,
          item.turnId,
          item.activity,
          item.segmentIndex,
          activityContainerStatusForRuntime(item, contextState),
          thread.id || sessionId
        );
      }
      const collabActivities = await readDesktopCollabActivities(thread.path, activityOptions);
      for (const item of collabActivities) {
        upsertDesktopActivity(
          messages,
          item.turnId,
          item.activity,
          item.segmentIndex,
          activityContainerStatusForRuntime(item, contextState),
          thread.id || sessionId
        );
      }
      messages.splice(0, messages.length, ...removeDuplicateGuidedUserSegments(messages));
      sortDesktopActivitySteps(messages);
    }
    const orderedMessages = sortMessagesByConversationOrder(filterDeletedMessages(messages, deletedIds));

    return {
      ...page,
      messages: orderedMessages,
      context: publicContextState(contextState, getConfigContext() || {})
    };
  }

  return { readSessionMessages };
}
