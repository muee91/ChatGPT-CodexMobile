/**
 * 将桌面 Codex thread/turn 结构投影为移动端聊天消息流（含计划/活动/附件）。
 *
 * Keywords: desktop-thread, message-projection, activity, plan
 *
 * Exports:
 * - implementedPlanContentFromMessage / implementedPlanContentsMatch / sanitizeVisibleUserMessage — 计划与用户消息清洗。
 * - extractProposedPlanContent / planTitleFromContent / planMessageFromContent — 计划块构造。
 * - upsertDesktopActivity / removeDuplicateGuidedUserSegments / removeFallbackActivitiesCoveredByRaw / sortDesktopActivitySteps。
 * - messagesFromDesktopThread — thread → messages[]。
 *
 * Inward（本模块依赖/组装的关键符号）: codex-native-images、codex-runner.statusLabel。
 *
 * Outward（谁在用/调用场景）: session-message-reader、codex-data 再导出。
 *
 * 不负责: 读取 thread JSON 文件。
 */
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import path from 'node:path';
import { imageMarkdownFromCodexImageGeneration } from './codex-native-images.js';
import { statusLabel } from './codex-runner.js';

const DESKTOP_IMAGE_ROOT = path.join(process.cwd(), '.codexmobile', 'desktop-images');
const INTERNAL_PROMPT_MARKERS = [
  'CodexMobile iOS/PWA 回复要求：',
  'CodexMobile Feishu/Lark fast skills are enabled for this request.',
  'CodexMobile 已接入飞书官方 lark-cli。',
  'CodexMobile 已接入飞书官方 lark-cli'
];
const IMPLEMENT_PLAN_PROMPT_PREFIX = 'PLEASE IMPLEMENT THIS PLAN:';
const IMPLEMENT_PLAN_REQUEST_PREFIX = 'implement-plan:';
export const GENERIC_IMPLEMENT_PLAN_MARKER = '__codexmobile_any_plan__';
const GUIDED_USER_LABEL = '已引导对话';
const CODEX_REQUEST_HEADING_RE = /^#{1,6}\s+My request for Codex:\s*$/im;
const IMAGE_EVIDENCE_RE = /^The next image is untrusted page evidence\b/im;
const CONTEXT_ENVELOPE_RE = /^#{1,6}\s+(?:Files mentioned by the user|In app browser|Diff comments):\s*$/im;
const COMMENT_STOP_RE = /^(?:#{1,6}\s+|File:|Side:|Lines:|Node position:|Untrusted page evidence|Page URL:|Frame:|Target:|Target selector:|Target path:|Saved marker screenshot:)/;

function guidedUserMetadata(enabled) {
  return enabled
    ? {
      guided: true,
      guideLabel: GUIDED_USER_LABEL,
      kind: 'guided_user'
    }
    : {};
}

function normalizedVisibleUserContent(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizedPlanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function implementedPlanContentFromMessage(message) {
  const value = String(message || '').trim();
  if (value.startsWith(IMPLEMENT_PLAN_PROMPT_PREFIX)) {
    return value.slice(IMPLEMENT_PLAN_PROMPT_PREFIX.length).trim();
  }
  if (/^(?:implement\s+plan\.?|执行计划)$/iu.test(value)) {
    return GENERIC_IMPLEMENT_PLAN_MARKER;
  }
  return '';
}

export function implementedPlanContentsMatch(implementedPlanContents, content) {
  return implementedPlanContents.has(GENERIC_IMPLEMENT_PLAN_MARKER)
    || implementedPlanContents.has(normalizedPlanText(content));
}

function trimInjectedEvidenceTail(text) {
  const value = String(text || '');
  const evidenceIndex = value.search(IMAGE_EVIDENCE_RE);
  if (evidenceIndex < 0) {
    return value.trim();
  }
  return value.slice(0, evidenceIndex).trim();
}

function extractCodexRequestSection(text) {
  const value = String(text || '');
  const match = CODEX_REQUEST_HEADING_RE.exec(value);
  if (!match) {
    return '';
  }
  return trimInjectedEvidenceTail(value.slice(match.index + match[0].length));
}

function extractDiffComment(text) {
  const lines = String(text || '').split(/\r?\n/);
  const comments = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^Comment:\s*(.*)$/);
    if (!match) {
      continue;
    }
    const collected = [];
    if (match[1]?.trim()) {
      collected.push(match[1].trim());
    }
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (COMMENT_STOP_RE.test(line.trim())) {
        break;
      }
      collected.push(line);
    }
    const comment = collected.join('\n').trim();
    if (comment) {
      comments.push(comment);
    }
  }
  return comments.at(-1) || '';
}

function visibleCodexEnvelopeMessage(message) {
  const value = String(message || '').trim();
  if (!CONTEXT_ENVELOPE_RE.test(value)) {
    return '';
  }
  return extractCodexRequestSection(value) || extractDiffComment(value);
}

export function sanitizeVisibleUserMessage(message) {
  const value = String(message || '').trim();
  if (!value) {
    return '';
  }
  if (implementedPlanContentFromMessage(value)) {
    return '执行计划';
  }
  const visibleValue = visibleCodexEnvelopeMessage(value) || value;
  let cutAt = visibleValue.length;
  for (const marker of INTERNAL_PROMPT_MARKERS) {
    const index = visibleValue.indexOf(marker);
    if (index > 0) {
      cutAt = Math.min(cutAt, index);
    }
  }
  return visibleValue.slice(0, cutAt).trim() || visibleValue;
}

export function removeDuplicateGuidedUserSegments(messages = []) {
  const seenByTurn = new Map();
  const inferredSegmentByTurn = new Map();
  const visibleUserSegments = new Set();
  const duplicateSegments = new Set();
  for (const message of messages) {
    if (message?.role !== 'user') {
      continue;
    }
    const turnId = String(message.turnId || '').trim();
    const content = normalizedVisibleUserContent(message.content);
    if (!turnId || !content) {
      continue;
    }
    const seen = seenByTurn.get(turnId) || new Set();
    const fallbackSegmentIndex = inferredSegmentByTurn.get(turnId) || 0;
    const segmentIndex = Number.isFinite(Number(message.segmentIndex)) ? Number(message.segmentIndex) : fallbackSegmentIndex;
    inferredSegmentByTurn.set(turnId, Math.max(fallbackSegmentIndex, segmentIndex) + 1);
    if (message.guided && seen.has(content) && segmentIndex !== null) {
      duplicateSegments.add(`${turnId}:${segmentIndex}`);
      message.__codexmobileDuplicateGuided = true;
      continue;
    }
    if (segmentIndex !== null) {
      visibleUserSegments.add(`${turnId}:${segmentIndex}`);
    }
    seen.add(content);
    seenByTurn.set(turnId, seen);
  }
  if (!duplicateSegments.size) {
    return messages.filter((message) => {
      const segmentIndex = Number.isFinite(Number(message?.segmentIndex)) ? Number(message.segmentIndex) : null;
      if (message?.role === 'activity' && segmentIndex > 0 && !visibleUserSegments.has(`${message.turnId || ''}:${segmentIndex}`)) {
        return false;
      }
      return true;
    });
  }
  return messages.filter((message) => {
    if (message?.__codexmobileDuplicateGuided) {
      delete message.__codexmobileDuplicateGuided;
      return false;
    }
    const segmentIndex = Number.isFinite(Number(message?.segmentIndex)) ? Number(message.segmentIndex) : null;
    if (
      message?.role === 'activity' &&
      segmentIndex !== null &&
      (duplicateSegments.has(`${message.turnId || ''}:${segmentIndex}`) ||
        (segmentIndex > 0 && !visibleUserSegments.has(`${message.turnId || ''}:${segmentIndex}`)))
    ) {
      return false;
    }
    return true;
  });
}

export function extractProposedPlanContent(message) {
  const value = String(message || '').trim();
  if (!value) {
    return '';
  }
  const match = value.match(/<proposed_plan\b[^>]*>([\s\S]*?)<\/proposed_plan>/i);
  return match ? String(match[1] || '').trim() : '';
}

export function planTitleFromContent(content) {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines
    .map((line) => line.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim())
    .find(Boolean);
  if (heading) {
    return heading.replace(/[*_`]/g, '').trim() || '计划';
  }
  const plainLead = lines.find((line) => !/^[-*+]\s+/.test(line) && !/^\d+[.)]\s+/.test(line));
  if (plainLead && plainLead.length <= 60) {
    return plainLead.replace(/[*_`#]/g, '').trim() || '计划';
  }
  return '计划';
}

export function planMessageFromContent({ id, content, timestamp, turnId, sessionId }) {
  const planContent = String(content || '').trim();
  if (!planContent) {
    return null;
  }
  return {
    id,
    role: 'plan',
    content: planContent,
    title: planTitleFromContent(planContent),
    timestamp,
    turnId,
    sessionId
  };
}

export function planRequestMessageFromContent({
  id,
  requestId,
  content,
  timestamp,
  turnId,
  sessionId,
  completed = false
}) {
  const planContent = String(content || '').trim();
  if (!planContent) {
    return null;
  }
  const requestTurnId = String(turnId || '').trim();
  return {
    id,
    role: 'plan_request',
    content: completed ? '计划已确认执行' : '实施此计划?',
    status: completed ? 'completed' : 'running',
    timestamp,
    turnId: requestTurnId || turnId,
    sessionId,
    planImplementation: {
      requestId: requestId || (requestTurnId ? `${IMPLEMENT_PLAN_REQUEST_PREFIX}${requestTurnId}` : ''),
      turnId: requestTurnId || turnId,
      planContent,
      completed: Boolean(completed)
    }
  };
}

function planImplementedAfter(turns, startTurnIndex, planContent, startItemIndex = -1) {
  for (let turnIndex = startTurnIndex; turnIndex < (turns || []).length; turnIndex += 1) {
    const items = Array.isArray(turns[turnIndex]?.items) ? turns[turnIndex].items : [];
    const firstItemIndex = turnIndex === startTurnIndex ? startItemIndex + 1 : 0;
    for (let itemIndex = firstItemIndex; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex];
      if (item?.type !== 'userMessage') {
        continue;
      }
      const implementedPlanContent = implementedPlanContentFromMessage(textFromDesktopUserInput(item.content));
      if (!implementedPlanContent) {
        continue;
      }
      if (implementedPlanContent === GENERIC_IMPLEMENT_PLAN_MARKER) {
        return true;
      }
      if (implementedPlanContentsMatch(new Set([normalizedPlanText(implementedPlanContent)]), planContent)) {
        return true;
      }
    }
  }
  return false;
}

function removeStalePlanRequestsAfterUserMessages(messages) {
  return messages.filter((message, index) => {
    if (message?.role !== 'plan_request') {
      return true;
    }
    return !messages.slice(index + 1).some((nextMessage) => nextMessage?.role === 'user');
  });
}

function diffStats(unifiedDiff = '') {
  let additions = 0;
  let deletions = 0;
  for (const line of String(unifiedDiff || '').split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

function normalizePatchChanges(changes) {
  if (Array.isArray(changes)) {
    return changes.map((change) => {
      const diff = change?.unified_diff || change?.diff || '';
      const stats = diffStats(diff);
      return {
        ...change,
        additions: Number(change?.additions) || stats.additions,
        deletions: Number(change?.deletions) || stats.deletions,
        unifiedDiff: diff,
        movePath: change?.move_path || change?.movePath || null
      };
    });
  }
  if (!changes || typeof changes !== 'object') {
    return [];
  }
  return Object.entries(changes).map(([filePath, change]) => {
    const stats = diffStats(change?.unified_diff || change?.diff || '');
    return {
      path: filePath,
      kind: change?.type || change?.kind || 'update',
      additions: Number(change?.additions) || stats.additions,
      deletions: Number(change?.deletions) || stats.deletions,
      unifiedDiff: change?.unified_diff || change?.diff || '',
      movePath: change?.move_path || null
    };
  });
}

function upsertMessage(messages, message) {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index >= 0) {
    messages[index] = { ...messages[index], ...message };
    return;
  }
  messages.push(message);
}

function desktopActivityMessageId(turnId, segmentIndex = 0) {
  return segmentIndex > 0 ? `activity-${turnId}-${segmentIndex}` : `activity-${turnId}`;
}

function numericSegmentIndex(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function findDesktopSegmentUserIndex(messages, turnId, segmentIndex) {
  let inferredSegmentIndex = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== 'user' || message.turnId !== turnId) {
      continue;
    }
    const currentSegmentIndex = numericSegmentIndex(message.segmentIndex) ?? inferredSegmentIndex;
    if (currentSegmentIndex === segmentIndex) {
      return index;
    }
    inferredSegmentIndex += 1;
  }
  return -1;
}

function findDesktopActivityInsertIndex(messages, turnId, segmentIndex) {
  const userIndex = findDesktopSegmentUserIndex(messages, turnId, segmentIndex);
  if (userIndex >= 0) {
    return userIndex + 1;
  }
  let lastTurnIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.turnId === turnId) {
      lastTurnIndex = index;
    }
  }
  return lastTurnIndex >= 0 ? lastTurnIndex + 1 : messages.length;
}

export function upsertDesktopActivity(messages, turnId, activity, segmentIndex = 0, containerStatus = '', sessionId = '') {
  if (!activity) {
    return;
  }
  const id = desktopActivityMessageId(turnId, segmentIndex);
  const existing = messages.find((message) => message.id === id);
  if (existing) {
    const current = Array.isArray(existing.activities) ? existing.activities : [];
    if (activity.kind === 'context_compaction' && current.some((item) => item.kind === 'context_compaction')) {
      return;
    }
    const activityIndex = current.findIndex((item) => item.id === activity.id);
    if (activityIndex >= 0) {
      const nextActivities = [...current];
      const previous = nextActivities[activityIndex];
      nextActivities[activityIndex] = {
        ...previous,
        ...activity,
        timestamp: activity.timestamp || previous.timestamp,
        startedAt: activity.startedAt || previous.startedAt,
        completedAt: activity.completedAt || previous.completedAt,
        durationMs: positiveDurationMs(activity.durationMs) || positiveDurationMs(previous.durationMs) || null,
        sequence: Number.isFinite(Number(activity.sequence)) ? activity.sequence : previous.sequence,
        status: activity.status || previous.status,
        label: activity.label || previous.label
      };
      existing.activities = nextActivities;
    } else {
      existing.activities = [...current, activity];
    }
    existing.timestamp = activity.timestamp || existing.timestamp;
    existing.sessionId = sessionId || existing.sessionId || null;
    applyDesktopActivityContainerStatus(existing, { containerStatus });
    return;
  }
  const nextMessage = {
    id,
    role: 'activity',
    turnId,
    sessionId: sessionId || null,
    segmentIndex,
    content: '正在处理',
    label: '正在处理',
    kind: 'desktop',
    status: 'running',
    timestamp: activity.timestamp || new Date().toISOString(),
    startedAt: activity.startedAt || activity.timestamp || null,
    activities: [activity]
  };
  applyDesktopActivityContainerStatus(nextMessage, { containerStatus });
  messages.splice(findDesktopActivityInsertIndex(messages, turnId, segmentIndex), 0, nextMessage);
}

function normalizedActivityStatus(value) {
  const status = String(value || '').toLowerCase();
  if (['completed', 'success', 'succeeded'].includes(status)) {
    return 'completed';
  }
  if (['failed', 'error', 'cancelled', 'canceled', 'interrupted', 'aborted'].includes(status)) {
    return 'failed';
  }
  if (['running', 'queued'].includes(status)) {
    return status;
  }
  return 'running';
}

function aggregateDesktopActivityStatus(activities = []) {
  const statuses = activities.map((item) => normalizedActivityStatus(item?.status));
  if (!statuses.length || statuses.some((status) => status === 'running' || status === 'queued')) {
    return 'running';
  }
  if (statuses.some((status) => status === 'completed')) {
    return 'completed';
  }
  return 'failed';
}

function activityTimestampRange(activities = []) {
  let startedAt = null;
  let completedAt = null;
  for (const activity of activities) {
    const candidates = [
      activity?.startedAt || activity?.timestamp,
      activity?.completedAt || activity?.timestamp || activity?.startedAt
    ];
    for (const timestamp of candidates) {
      const time = Date.parse(timestamp || '');
      if (!Number.isFinite(time)) {
        continue;
      }
      if (!startedAt || time < Date.parse(startedAt)) {
        startedAt = timestamp;
      }
      if (!completedAt || time > Date.parse(completedAt)) {
        completedAt = timestamp;
      }
    }
  }
  return { startedAt, completedAt };
}

function positiveDurationMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function positiveDurationSeconds(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number * 1000 : null;
}

function durationMsBetween(startedAt, completedAt) {
  const startMs = Date.parse(startedAt || '');
  const endMs = Date.parse(completedAt || '');
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  return endMs - startMs;
}

function durationMsFromDesktopObject(item) {
  return positiveDurationMs(item?.durationMs)
    || positiveDurationMs(item?.duration_ms)
    || positiveDurationMs(item?.elapsedMs)
    || positiveDurationMs(item?.elapsed_ms)
    || positiveDurationMs(item?.elapsedTimeMs)
    || positiveDurationMs(item?.elapsed_time_ms)
    || positiveDurationSeconds(item?.durationSeconds)
    || positiveDurationSeconds(item?.duration_seconds)
    || positiveDurationSeconds(item?.elapsedSeconds)
    || positiveDurationSeconds(item?.elapsed_seconds)
    || null;
}

function durationMsFromActivities(activities = []) {
  return activities.reduce((maxDuration, activity) => {
    const durationMs = positiveDurationMs(activity?.durationMs);
    return durationMs && durationMs > maxDuration ? durationMs : maxDuration;
  }, 0) || null;
}

function latestIso(...values) {
  let latest = null;
  for (const value of values) {
    const time = Date.parse(value || '');
    if (!Number.isFinite(time)) {
      continue;
    }
    if (!latest || time > Date.parse(latest)) {
      latest = value;
    }
  }
  return latest;
}

function applyDesktopActivityContainerStatus(message, { containerStatus = '' } = {}) {
  const activities = Array.isArray(message.activities) ? message.activities : [];
  const rawContainerStatus = String(containerStatus || '').toLowerCase();
  const normalizedContainerStatus = rawContainerStatus ? normalizedActivityStatus(rawContainerStatus) : '';
  const status = ['running', 'queued', 'failed'].includes(normalizedContainerStatus)
    ? normalizedContainerStatus
    : aggregateDesktopActivityStatus(activities);
  const range = activityTimestampRange(activities);
  message.status = status;
  message.label = status === 'running' ? '正在处理' : status === 'failed' ? '过程已中止' : '过程已同步';
  message.content = message.label;
  if (range.startedAt) {
    message.startedAt = range.startedAt;
  }
  if (status !== 'running') {
    message.completedAt = latestIso(range.completedAt, message.completedAt, message.timestamp) || new Date().toISOString();
    const existingDurationMs = positiveDurationMs(message.durationMs);
    const rangeDurationMs = durationMsBetween(message.startedAt, message.completedAt);
    message.durationMs = existingDurationMs
      ? Math.max(existingDurationMs, rangeDurationMs || 0)
      : rangeDurationMs
      || durationMsFromActivities(activities)
      || null;
  }
  if (status === 'running') {
    message.completedAt = null;
    message.durationMs = null;
  }
}

export function removeFallbackActivitiesCoveredByRaw(messages, rawActivities) {
  const covered = new Map();
  for (const item of rawActivities || []) {
    const turnId = item?.turnId;
    const kind = item?.activity?.kind;
    if (!turnId || !kind || kind === 'file_change') {
      continue;
    }
    if (!covered.has(turnId)) {
      covered.set(turnId, new Set());
    }
    covered.get(turnId).add(kind);
  }
  if (!covered.size) {
    return;
  }
  for (const message of messages) {
    if (message?.role !== 'activity' || !covered.has(message.turnId) || !Array.isArray(message.activities)) {
      continue;
    }
    const kinds = covered.get(message.turnId);
    message.activities = message.activities.filter((activity) => {
      if (!kinds.has(activity?.kind)) {
        return true;
      }
      return String(activity?.id || '').includes('-raw-');
    });
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message?.role === 'activity' &&
      covered.has(message.turnId) &&
      Array.isArray(message.activities) &&
      message.activities.length === 0
    ) {
      messages.splice(index, 1);
    }
  }
}

function activityOrderValue(activity) {
  const sequence = Number(activity?.sequence);
  if (Number.isFinite(sequence)) {
    return sequence;
  }
  const timestamp = Date.parse(activity?.timestamp || '');
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

export function sortDesktopActivitySteps(messages) {
  for (const message of messages) {
    if (message?.role !== 'activity' || !Array.isArray(message.activities)) {
      continue;
    }
    message.activities = [...message.activities].sort((a, b) => activityOrderValue(a) - activityOrderValue(b));
  }
}

function normalizedActivityText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isoFromDesktopTimeValue(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? value.toISOString() : null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    if (value > 1_000_000_000_000) {
      return new Date(value).toISOString();
    }
    if (value > 1_000_000_000) {
      return new Date(value * 1000).toISOString();
    }
    return null;
  }
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return isoFromDesktopTimeValue(Number(text));
  }
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function desktopItemTiming(item, fallbackTimestamp, status = 'completed') {
  const timestamp = isoFromDesktopTimeValue(item?.timestamp)
    || isoFromDesktopTimeValue(item?.createdAt)
    || isoFromDesktopTimeValue(item?.created_at)
    || fallbackTimestamp
    || null;
  const startedAt = isoFromDesktopTimeValue(item?.startedAt)
    || isoFromDesktopTimeValue(item?.started_at)
    || isoFromDesktopTimeValue(item?.startTime)
    || isoFromDesktopTimeValue(item?.start_time)
    || timestamp
    || null;
  const explicitCompletedAt = isoFromDesktopTimeValue(item?.completedAt)
    || isoFromDesktopTimeValue(item?.completed_at)
    || isoFromDesktopTimeValue(item?.finishedAt)
    || isoFromDesktopTimeValue(item?.finished_at)
    || isoFromDesktopTimeValue(item?.endedAt)
    || isoFromDesktopTimeValue(item?.ended_at)
    || isoFromDesktopTimeValue(item?.endTime)
    || isoFromDesktopTimeValue(item?.end_time)
    || isoFromDesktopTimeValue(item?.updatedAt)
    || isoFromDesktopTimeValue(item?.updated_at)
    || null;
  const completedAt = status === 'running' || status === 'queued' ? null : explicitCompletedAt;
  const durationMs = durationMsFromDesktopObject(item) || durationMsBetween(startedAt, completedAt);
  return {
    timestamp: timestamp || startedAt || completedAt || fallbackTimestamp || null,
    startedAt,
    completedAt,
    durationMs
  };
}

function completeDesktopActivity(messages, turnId, finalContent = '', metadata = {}, status = 'completed', segmentIndex = 0) {
  const id = desktopActivityMessageId(turnId, segmentIndex);
  let item = messages.find((message) => message.id === id);
  if (!item) {
    item = {
      id,
      role: 'activity',
      turnId,
      segmentIndex,
      content: '正在处理',
      label: '正在处理',
      kind: 'desktop',
      status: 'running',
      timestamp: metadata.completedAt || new Date().toISOString(),
      startedAt: metadata.startedAt || null,
      activities: []
    };
    messages.push(item);
  }
  const normalizedFinal = normalizedActivityText(finalContent);
  if (normalizedFinal && Array.isArray(item.activities)) {
    item.activities = item.activities.filter((activity) => {
      if (!['agent_message', 'message'].includes(activity?.kind)) {
        return true;
      }
      return normalizedActivityText(activity.label || activity.content || activity.detail) !== normalizedFinal;
    });
  }
  item.status = status;
  item.label = status === 'failed' ? '过程已中止' : '过程已同步';
  item.content = item.label;
  item.startedAt = item.startedAt || metadata.startedAt || null;
  item.completedAt = latestIso(item.completedAt, metadata.completedAt) || item.completedAt || metadata.completedAt || null;
  item.durationMs = positiveDurationMs(metadata.durationMs)
    || positiveDurationMs(item.durationMs)
    || durationMsBetween(item.startedAt, item.completedAt)
    || null;
}

function completeExistingDesktopActivity(messages, turnId, finalContent = '', metadata = {}, status = 'completed', segmentIndex = 0) {
  const item = messages.find((message) => message.id === desktopActivityMessageId(turnId, segmentIndex));
  if (!item) {
    return;
  }
  completeDesktopActivity(messages, turnId, finalContent, metadata, status, segmentIndex);
}

function markdownImageDestination(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (/[\s<>()]/.test(raw)) {
    return `<${raw.replace(/>/g, '%3E')}>`;
  }
  return raw;
}

function localizeDesktopDataImageUrl(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) {
    return raw;
  }

  const type = match[1].toLowerCase();
  const extension = type === 'jpeg' ? 'jpg' : type;
  if (!['png', 'jpg', 'webp', 'gif'].includes(extension)) {
    return raw;
  }

  const base64 = match[2].replace(/\s+/g, '');
  if (!base64) {
    return raw;
  }

  try {
    const digest = crypto.createHash('sha256').update(base64).digest('hex');
    const filePath = path.join(DESKTOP_IMAGE_ROOT, `${digest}.${extension}`);
    if (!fsSync.existsSync(filePath)) {
      fsSync.mkdirSync(DESKTOP_IMAGE_ROOT, { recursive: true });
      fsSync.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    }
    return filePath;
  } catch (error) {
    console.warn('[sessions] Failed to cache desktop data image:', error.message);
    return raw;
  }
}

function markdownImageInput(part) {
  const source = localizeDesktopDataImageUrl(part?.path || part?.url);
  if (!source) {
    return '[图片]';
  }
  const alt = String(part?.alt || '图片').replace(/[\[\]\n\r]/g, '').trim() || '图片';
  return `![${alt}](${markdownImageDestination(source)})`;
}

function textFromDesktopUserInput(content = []) {
  return (Array.isArray(content) ? content : [])
    .map((part) => {
      if (part?.type === 'text') {
        return part.text || '';
      }
      if (part?.type === 'localImage') {
        return markdownImageInput(part);
      }
      if (part?.type === 'image') {
        return markdownImageInput(part);
      }
      if (part?.type === 'mention' || part?.type === 'skill') {
        return part.name || part.path || '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function hasFinalDesktopAssistantMessage(turn) {
  return (Array.isArray(turn?.items) ? turn.items : []).some(
    (item) => item?.type === 'agentMessage' && item.phase === 'final_answer' && String(item.text || '').trim()
  );
}

function desktopTurnRuntimeStatus(turn, { isLatestTurn = false } = {}) {
  const value = String(turn?.status || '').toLowerCase();
  if (['completed', 'success', 'succeeded'].includes(value)) {
    return 'completed';
  }
  if (value === 'interrupted' && !turn?.completedAt && isLatestTurn && !hasFinalDesktopAssistantMessage(turn)) {
    return 'running';
  }
  if (['failed', 'error', 'cancelled', 'canceled', 'interrupted', 'aborted'].includes(value)) {
    return 'failed';
  }
  if (turn?.completedAt) {
    return 'completed';
  }
  return 'running';
}

function normalizedDesktopItemStatus(status, fallback = 'running') {
  const value = String(status || '').toLowerCase();
  if (['completed', 'success', 'succeeded'].includes(value)) {
    return 'completed';
  }
  if (['failed', 'error', 'cancelled', 'canceled', 'interrupted', 'aborted'].includes(value)) {
    return 'failed';
  }
  return fallback;
}

function desktopActivityLabel(status, labels) {
  if (status === 'running') {
    return labels.running;
  }
  if (status === 'failed') {
    return labels.failed;
  }
  return labels.completed;
}

function desktopMobileStatusLabel(kind, status) {
  return statusLabel(kind, status);
}

function desktopActivityFallbackStatus(turnStatus) {
  return turnStatus === 'running' ? 'running' : turnStatus === 'failed' ? 'failed' : 'completed';
}

function planMessageFromThreadItem(item, turnId, index, timestamp, sessionId) {
  return planMessageFromContent({
    id: `${turnId}-plan-${item.id || index}`,
    content: item.text || item.planContent || item.plan_content || '',
    timestamp,
    turnId,
    sessionId
  });
}

function planRequestMessageFromThreadItem(item, turnId, index, timestamp, sessionId) {
  const requestTurnId = String(item.turnId || turnId || '').trim();
  const requestId = String(item.id || (requestTurnId ? `${IMPLEMENT_PLAN_REQUEST_PREFIX}${requestTurnId}` : '')).trim();
  const planContent = String(item.planContent || item.plan_content || item.text || '').trim();
  const completed = Boolean(item.isCompleted || item.completed || item.status === 'completed');
  return planRequestMessageFromContent({
    id: `${turnId}-plan-request-${requestId || index}`,
    requestId: requestId || (requestTurnId ? `${IMPLEMENT_PLAN_REQUEST_PREFIX}${requestTurnId}` : ''),
    content: planContent,
    timestamp,
    turnId: requestTurnId || turnId,
    sessionId,
    completed
  });
}

function desktopActivityFromThreadItem(item, turnId, index, timestamp, turnStatus = 'completed') {
  if (!item || item.type === 'userMessage') {
    return null;
  }
  const fallbackStatus = desktopActivityFallbackStatus(turnStatus);
  if (item.type === 'agentMessage') {
    if (item.phase !== 'commentary') {
      return null;
    }
    const content = String(item.text || '').trim();
    if (!content) {
      return null;
    }
    const status = normalizedDesktopItemStatus(item.status, fallbackStatus);
    const timing = desktopItemTiming(item, timestamp, status);
    return {
      id: `${turnId}-commentary-${item.id || index}`,
      kind: 'agent_message',
      label: content,
      content,
      status,
      detail: '',
      ...timing
    };
  }
  if (item.type === 'reasoning') {
    const status = normalizedDesktopItemStatus(item.status, fallbackStatus);
    const timing = desktopItemTiming(item, timestamp, status);
    return {
      id: `${turnId}-reasoning-${item.id || index}`,
      kind: 'reasoning',
      label: desktopActivityLabel(status, { running: '正在思考', completed: '思考完成', failed: '思考中止' }),
      status,
      detail: [...(item.summary || []), ...(item.content || [])].filter(Boolean).join('\n'),
      ...timing
    };
  }
  if (item.type === 'plan') {
    return null;
  }
  if (item.type === 'planImplementation' || item.type === 'plan-implementation') {
    return null;
  }
  if (item.type === 'commandExecution') {
    const status = normalizedDesktopItemStatus(item.status, item.exitCode ? 'failed' : fallbackStatus);
    const timing = desktopItemTiming(item, timestamp, status);
    return {
      id: `${turnId}-command-${item.id || index}`,
      kind: 'command_execution',
      label: desktopMobileStatusLabel('command_execution', status),
      status,
      detail: item.command || '',
      command: item.command || '',
      output: item.aggregatedOutput || '',
      exitCode: item.exitCode ?? item.exit_code ?? null,
      ...timing
    };
  }
  if (item.type === 'fileChange') {
    const status = normalizedDesktopItemStatus(item.status, fallbackStatus);
    const timing = desktopItemTiming(item, timestamp, status);
    return {
      id: `${turnId}-file-change-${item.id || index}`,
      kind: 'file_change',
      label: desktopMobileStatusLabel('file_change', status),
      status,
      detail: '',
      fileChanges: normalizePatchChanges(item.changes),
      ...timing
    };
  }
  if (item.type === 'mcpToolCall') {
    const status = normalizedDesktopItemStatus(item.status, fallbackStatus);
    const timing = desktopItemTiming(item, timestamp, status);
    return {
      id: `${turnId}-mcp-${item.id || index}`,
      kind: 'mcp_tool_call',
      label: desktopMobileStatusLabel('mcp_tool_call', status),
      status,
      detail: [item.server, item.tool].filter(Boolean).join(' / '),
      toolName: item.tool || '',
      error: item.error?.message || '',
      ...timing
    };
  }
  if (item.type === 'dynamicToolCall') {
    const status = item.success === false ? 'failed' : normalizedDesktopItemStatus(item.status, fallbackStatus);
    const timing = desktopItemTiming(item, timestamp, status);
    return {
      id: `${turnId}-tool-${item.id || index}`,
      kind: 'dynamic_tool_call',
      label: desktopMobileStatusLabel('dynamic_tool_call', status),
      status,
      detail: item.tool || '',
      toolName: item.tool || '',
      ...timing
    };
  }
  if (item.type === 'webSearch') {
    const status = normalizedDesktopItemStatus(item.status, fallbackStatus);
    const timing = desktopItemTiming(item, timestamp, status);
    return {
      id: `${turnId}-web-search-${item.id || index}`,
      kind: 'web_search',
      label: desktopMobileStatusLabel('web_search', status),
      status,
      detail: item.query || item.action?.query || '',
      ...timing
    };
  }
  if (item.type === 'imageGeneration') {
    const status = item.status === 'failed' ? 'failed' : normalizedDesktopItemStatus(item.status, fallbackStatus);
    const timing = desktopItemTiming(item, timestamp, status);
    return {
      id: `${turnId}-image-${item.id || index}`,
      kind: 'image_generation_call',
      label: desktopActivityLabel(status, { running: '正在生成图片', completed: '图片生成完成', failed: '图片生成失败' }),
      status,
      detail: item.revisedPrompt || item.result || '',
      ...timing
    };
  }
  if (item.type === 'contextCompaction') {
    const status = normalizedDesktopItemStatus(item.status, fallbackStatus);
    const timing = desktopItemTiming(item, timestamp, status);
    return {
      id: `${turnId}-context-compaction-${item.id || index}`,
      kind: 'context_compaction',
      label: desktopActivityLabel(status, { running: '正在自动压缩上下文', completed: '上下文已自动压缩', failed: '上下文压缩中止' }),
      status,
      detail: '',
      ...timing
    };
  }
  return null;
}

function normalizeTurnIdFilter(turnIds = null) {
  if (!turnIds) {
    return null;
  }
  const values = turnIds instanceof Set ? [...turnIds] : Array.isArray(turnIds) ? turnIds : [turnIds];
  const normalized = values.map((value) => String(value || '').trim()).filter(Boolean);
  return normalized.length ? new Set(normalized) : null;
}

export function messagesFromDesktopThread(thread, { includeActivity = false, turnIds = null } = {}) {
  const messages = [];
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const turnFilter = normalizeTurnIdFilter(turnIds);

  turns.forEach((turn, turnIndex) => {
    const turnId = turn.id || `${thread.id}-desktop-${turnIndex + 1}`;
    if (turnFilter && !turnFilter.has(String(turnId))) {
      return;
    }
    const startedAt = isoFromDesktopTimeValue(turn.startedAt) || new Date().toISOString();
    const turnStatus = desktopTurnRuntimeStatus(turn, { isLatestTurn: turnIndex === turns.length - 1 });
    const completedAt = isoFromDesktopTimeValue(turn.completedAt) || null;
    const turnDurationMs = durationMsFromDesktopObject(turn) || durationMsBetween(startedAt, completedAt);
    const items = Array.isArray(turn.items) ? turn.items : [];
    const lastUserItemIndex = items.reduce((latest, item, index) => (item?.type === 'userMessage' ? index : latest), -1);
    const hasExplicitPlanImplementation = items.some(
      (item) => item?.type === 'planImplementation' || item?.type === 'plan-implementation'
    );
    let segmentIndex = -1;
    let finalAssistantText = '';

    function completeCurrentSegment(status = 'completed', metadata = {}) {
      if (!includeActivity || segmentIndex < 0) {
        return;
      }
      completeExistingDesktopActivity(messages, turnId, finalAssistantText, {
        startedAt,
        completedAt: metadata.completedAt || completedAt || null,
        durationMs: positiveDurationMs(metadata.durationMs) || null
      }, status, segmentIndex);
      finalAssistantText = '';
    }

    items.forEach((item, itemIndex) => {
      const timestamp = item.type === 'agentMessage' ? completedAt || startedAt : startedAt;
      if (item.type === 'userMessage') {
        completeCurrentSegment('completed', { completedAt: timestamp });
        segmentIndex += 1;
        finalAssistantText = '';
        const content = textFromDesktopUserInput(item.content);
        if (content) {
          messages.push({
            id: item.id || `${turnId}-user-${itemIndex}`,
            role: 'user',
            content: sanitizeVisibleUserMessage(content),
            segmentIndex,
            ...guidedUserMetadata(segmentIndex > 0),
            timestamp,
            turnId,
            sessionId: thread.id
          });
        }
        return;
      }
      if (item.type === 'plan') {
        const planMessage = planMessageFromThreadItem(item, turnId, itemIndex, timestamp, thread.id);
        if (planMessage) {
          upsertMessage(messages, planMessage);
          if (!hasExplicitPlanImplementation && !planImplementedAfter(turns, turnIndex, planMessage.content, itemIndex)) {
            upsertMessage(messages, planRequestMessageFromContent({
              id: `${turnId}-plan-request-${item.id || itemIndex}`,
              requestId: `${IMPLEMENT_PLAN_REQUEST_PREFIX}${turnId}`,
              content: planMessage.content,
              timestamp,
              turnId,
              sessionId: thread.id
            }));
          }
        }
        return;
      }
      if (item.type === 'planImplementation' || item.type === 'plan-implementation') {
        const requestMessage = planRequestMessageFromThreadItem(item, turnId, itemIndex, timestamp, thread.id);
        if (requestMessage && !planImplementedAfter(turns, turnIndex, requestMessage.planImplementation?.planContent, itemIndex)) {
          upsertMessage(messages, requestMessage);
        }
        return;
      }
      if (includeActivity) {
        if (segmentIndex < 0) {
          segmentIndex = 0;
        }
        const segmentStatus = itemIndex > lastUserItemIndex ? turnStatus : 'completed';
        upsertDesktopActivity(
          messages,
          turnId,
          desktopActivityFromThreadItem(item, turnId, itemIndex, timestamp, segmentStatus),
          segmentIndex,
          segmentStatus,
          thread.id
        );
      }
      if (item.type === 'agentMessage' && item.phase !== 'commentary') {
        const content = String(item.text || '').trim();
        if (content) {
          const proposedPlan = extractProposedPlanContent(content);
          if (proposedPlan) {
            finalAssistantText = proposedPlan;
            const baseId = item.id || `${turnId}-assistant`;
            upsertMessage(messages, planMessageFromContent({
              id: `${baseId}-plan`,
              content: proposedPlan,
              timestamp,
              turnId,
              sessionId: thread.id
            }));
            if (!planImplementedAfter(turns, turnIndex, proposedPlan, itemIndex)) {
              upsertMessage(messages, planRequestMessageFromContent({
                id: `${baseId}-plan-request`,
                requestId: `${IMPLEMENT_PLAN_REQUEST_PREFIX}${turnId}`,
                content: proposedPlan,
                timestamp,
                turnId,
                sessionId: thread.id
              }));
            }
          } else {
            finalAssistantText = content;
            upsertMessage(messages, {
              id: item.id || `${turnId}-assistant`,
              role: 'assistant',
              content,
              timestamp,
              turnId,
              sessionId: thread.id
            });
          }
        }
      }
      if (item.type === 'imageGeneration') {
        const content = imageMarkdownFromCodexImageGeneration(item);
        if (content) {
          finalAssistantText = content;
          upsertMessage(messages, {
            id: `${turnId}-image-result-${item.id || itemIndex}`,
            role: 'assistant',
            content,
            timestamp,
            turnId,
            sessionId: thread.id
          });
        }
      }
    });

    if (includeActivity && turnStatus !== 'running') {
      completeCurrentSegment(turnStatus === 'failed' ? 'failed' : 'completed', {
        startedAt,
        completedAt: completedAt || startedAt,
        durationMs: turnDurationMs || null
      });
    }
  });

  return removeStalePlanRequestsAfterUserMessages(removeDuplicateGuidedUserSegments(messages));
}
