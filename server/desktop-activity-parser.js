/**
 * 从会话 rollout JSONL 解析原始桌面活动（命令、文件变更、协作）供 thread 投影使用。
 *
 * Keywords: desktop-activity, jsonl, parser, rollout
 *
 * Exports:
 * - rawSessionActivitiesFromJsonl — 同步解析文本。
 * - readRawSessionActivities / readDesktopCollabActivities — 带路径的异步读取。
 *
 * Inward（本模块依赖/组装的关键符号）: codex-runner.statusLabel、readline 流式读。
 *
 * Outward（谁在用/调用场景）: session-message-reader、codex-data 再导出、测试。
 *
 * 不负责: 将活动转为聊天消息（见 desktop-thread-projector）。
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import readline from 'node:readline';
import { statusLabel } from './codex-runner.js';

const RAW_SESSION_ACTIVITY_OUTPUT_LIMIT = 6000;
const RAW_SESSION_COMMAND_TOOLS = new Set(['exec_command', 'write_stdin', 'read_thread_terminal']);

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

function agentStatusText(status = {}) {
  if (status.completed) {
    return '已完成';
  }
  if (status.failed || status.error) {
    return '失败';
  }
  if (status.running || status.queued || status.pending) {
    return '运行中';
  }
  return '打开';
}

function collabAgentSummary(agent) {
  return [agent.nickname, agent.role ? `(${agent.role})` : '', agent.statusText]
    .filter(Boolean)
    .join(' ');
}

function parseJsonObject(value) {
  if (!value) {
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function truncateActivityText(value, limit = RAW_SESSION_ACTIVITY_OUTPUT_LIMIT) {
  const text = String(value || '');
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n... truncated ${text.length - limit} chars`;
}

function cleanRawFunctionOutput(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const marker = '\nOutput:\n';
  const markerIndex = text.indexOf(marker);
  const visible = markerIndex >= 0 ? text.slice(markerIndex + marker.length) : text;
  return truncateActivityText(visible.trimEnd());
}

function rawFunctionExitCode(value) {
  const text = String(value || '');
  const match = text.match(/\bProcess exited with code (-?\d+)\b/i) || text.match(/\bExit code: (-?\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function rawFunctionStatus(outputRecord, missingOutputStatus = 'running') {
  if (!outputRecord) {
    return missingOutputStatus;
  }
  const exitCode = rawFunctionExitCode(outputRecord.output);
  if (exitCode === null) {
    return 'completed';
  }
  return exitCode === 0 ? 'completed' : 'failed';
}

function durationMsBetween(startedAt, completedAt) {
  const startMs = Date.parse(startedAt || '');
  const endMs = Date.parse(completedAt || '');
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
    ? endMs - startMs
    : null;
}

function rawFunctionTiming(payload = {}, outputRecord = null, status = 'running') {
  const startedAt = payload.timestamp || outputRecord?.timestamp || null;
  const terminal = ['completed', 'failed'].includes(String(status || ''));
  const completedAt = terminal ? outputRecord?.timestamp || null : null;
  return {
    timestamp: startedAt || completedAt || new Date().toISOString(),
    startedAt,
    completedAt,
    durationMs: terminal ? durationMsBetween(startedAt, completedAt) : null
  };
}

function rawToolStatus(outputRecord, missingOutputStatus = 'running') {
  if (!outputRecord) {
    return missingOutputStatus;
  }
  const exitCode = rawFunctionExitCode(outputRecord.output);
  if (exitCode !== null) {
    return exitCode === 0 ? 'completed' : 'failed';
  }
  const text = String(outputRecord.output || '');
  return /###\s*Error|\bError\b|not allowed|failed|failure/i.test(text) ? 'failed' : 'completed';
}

function epochMillisFromTurnValue(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return seconds * 1000;
}

function turnIdForRawActivityTimestamp(turns, timestamp) {
  const time = Date.parse(timestamp || '');
  if (!Number.isFinite(time) || !Array.isArray(turns) || turns.length === 0) {
    return null;
  }
  let latestStartedTurnId = null;
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index] || {};
    const turnId = turn.id;
    if (!turnId) {
      continue;
    }
    const start = epochMillisFromTurnValue(turn.startedAt);
    if (start === null) {
      continue;
    }
    const completed = epochMillisFromTurnValue(turn.completedAt);
    const nextStart = epochMillisFromTurnValue(turns[index + 1]?.startedAt);
    const end = completed ?? nextStart ?? Number.POSITIVE_INFINITY;
    if (time >= start - 5000 && time <= end + 5000) {
      return turnId;
    }
    if (time >= start) {
      latestStartedTurnId = turnId;
    }
  }
  return latestStartedTurnId;
}

function rawMissingOutputStatusForTurn(turns, turnId) {
  const turn = (Array.isArray(turns) ? turns : []).find((item) => item?.id === turnId);
  const status = String(turn?.status || '').toLowerCase();
  if (['completed', 'success', 'succeeded'].includes(status) || turn?.completedAt) {
    return 'completed';
  }
  if (['failed', 'error', 'cancelled', 'canceled', 'interrupted', 'aborted'].includes(status)) {
    return 'failed';
  }
  return 'running';
}

function comparableSequence(value) {
  const number = Number(value);
  if (Number.isFinite(number)) {
    return number;
  }
  const match = String(value || '').match(/^\d+/);
  return match ? Number(match[0]) : null;
}

function userSegmentMarkersFromMessages(messages, turns) {
  const countsByTurn = new Map();
  const markers = [];
  const userMessages = (Array.isArray(messages) ? messages : [])
    .filter(isVisibleRawUserSegmentMessage)
    .sort((a, b) => (comparableSequence(a.sequence) ?? 0) - (comparableSequence(b.sequence) ?? 0));

  for (const message of userMessages) {
    const turnId = turnIdForRawActivityTimestamp(turns, message.timestamp);
    if (!turnId) {
      continue;
    }
    const segmentIndex = countsByTurn.get(turnId) || 0;
    countsByTurn.set(turnId, segmentIndex + 1);
    markers.push({
      turnId,
      segmentIndex,
      sequence: comparableSequence(message.sequence),
      timestampMs: Date.parse(message.timestamp || '')
    });
  }
  return markers;
}

function isVisibleRawUserSegmentMessage(message) {
  if (message?.role !== 'user') {
    return false;
  }
  const text = responseMessageText(message);
  if (!text) {
    return false;
  }
  const trimmed = text.trim();
  if (/^<environment_context\b/i.test(trimmed)) {
    return false;
  }
  if (/^#\s*AGENTS\.md instructions\b/i.test(trimmed)) {
    return false;
  }
  return true;
}

function segmentIndexForRawActivity(markers, item) {
  const activity = item?.activity || {};
  const sequence = comparableSequence(activity.sequence);
  const timestampMs = Date.parse(activity.timestamp || '');
  let match = null;

  for (const marker of markers || []) {
    if (marker.turnId !== item?.turnId) {
      continue;
    }
    const sequenceApplies =
      Number.isFinite(sequence) && Number.isFinite(marker.sequence)
        ? marker.sequence <= sequence
        : false;
    const timestampApplies =
      Number.isFinite(timestampMs) && Number.isFinite(marker.timestampMs)
        ? marker.timestampMs <= timestampMs
        : false;
    if (sequenceApplies || (!Number.isFinite(sequence) && timestampApplies)) {
      match = marker;
    }
  }
  return match?.segmentIndex || 0;
}

function applyRawActivitySegments(items, messages, turns) {
  const markers = userSegmentMarkersFromMessages(messages, turns);
  if (!markers.length) {
    return items;
  }
  return items.map((item) => ({
    ...item,
    segmentIndex: segmentIndexForRawActivity(markers, item)
  }));
}

function rawCommandActivityFromCall({ payload, outputRecord, turns, sequence, command, toolName }) {
  const status = rawFunctionStatus(outputRecord, rawMissingOutputStatusForTurn(turns, turnIdForRawActivityTimestamp(turns, payload.timestamp)));
  const timing = rawFunctionTiming(payload, outputRecord, status);
  const timestamp = timing.timestamp;
  const turnId = turnIdForRawActivityTimestamp(turns, timestamp);
  if (!turnId || !command) {
    return null;
  }
  const exitCode = rawFunctionExitCode(outputRecord?.output);
  const idSuffix = payload.call_id || `${sequence}`;
  return {
    turnId,
    activity: {
      id: `${turnId}-raw-command-${idSuffix}`,
      kind: 'command_execution',
      label: desktopMobileStatusLabel('command_execution', status),
      status,
      detail: command,
      command,
      output: cleanRawFunctionOutput(outputRecord?.output),
      exitCode,
      toolName,
      timestamp,
      startedAt: timing.startedAt,
      completedAt: timing.completedAt,
      durationMs: timing.durationMs,
      sequence
    }
  };
}

function responseMessageText(payload) {
  const content = Array.isArray(payload?.content) ? payload.content : [];
  return content
    .map((item) => item?.text || item?.content || '')
    .filter(Boolean)
    .join('')
    .trim();
}

function rawAgentActivityFromMessage(payload, turns, sequence) {
  if (payload.role !== 'assistant' || payload.phase !== 'commentary') {
    return null;
  }
  const content = responseMessageText(payload);
  const timestamp = payload.timestamp || new Date().toISOString();
  const turnId = turnIdForRawActivityTimestamp(turns, timestamp);
  if (!turnId || !content) {
    return null;
  }
  return {
    turnId,
    activity: {
      id: `${turnId}-raw-agent-${payload.id || sequence}`,
      kind: 'agent_message',
      label: content,
      content,
      status: 'completed',
      detail: '',
      timestamp,
      sequence
    }
  };
}

function rawContextCompactionActivityFromEntry({ timestamp, turns, sequence }) {
  const turnId = turnIdForRawActivityTimestamp(turns, timestamp);
  if (!turnId) {
    return null;
  }
  return {
    turnId,
    activity: {
      id: `${turnId}-raw-context-compaction-${sequence}`,
      kind: 'context_compaction',
      label: '上下文已自动压缩',
      status: 'completed',
      detail: '',
      timestamp,
      sequence
    }
  };
}

function rawPlanActivityFromCall({ payload, outputRecord, turns, sequence }) {
  const status = rawFunctionStatus(outputRecord, rawMissingOutputStatusForTurn(turns, turnIdForRawActivityTimestamp(turns, payload.timestamp)));
  const timing = rawFunctionTiming(payload, outputRecord, status);
  const timestamp = timing.timestamp;
  const turnId = turnIdForRawActivityTimestamp(turns, timestamp);
  if (!turnId) {
    return null;
  }
  const args = parseJsonObject(payload.arguments);
  const steps = Array.isArray(args.plan) ? args.plan : [];
  const detail = steps
    .map((item) => [item?.status, item?.step].filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n');
  const idSuffix = payload.call_id || `${sequence}`;
  return {
    turnId,
    activity: {
      id: `${turnId}-raw-plan-${idSuffix}`,
      kind: 'plan',
      label: desktopActivityLabel(status, { running: '正在更新计划', completed: '计划已更新', failed: '计划更新中止' }),
      status,
      detail,
      timestamp,
      startedAt: timing.startedAt,
      completedAt: timing.completedAt,
      durationMs: timing.durationMs,
      sequence
    }
  };
}

function rawMcpActivityFromCall({ payload, outputRecord, turns, sequence }) {
  const namespace = String(payload.namespace || '').trim();
  if (!namespace.startsWith('mcp__')) {
    return null;
  }
  const status = rawToolStatus(outputRecord, rawMissingOutputStatusForTurn(turns, turnIdForRawActivityTimestamp(turns, payload.timestamp)));
  const timing = rawFunctionTiming(payload, outputRecord, status);
  const timestamp = timing.timestamp;
  const turnId = turnIdForRawActivityTimestamp(turns, timestamp);
  if (!turnId) {
    return null;
  }
  const server = namespace.replace(/^mcp__/, '').replace(/__+/g, '/');
  const tool = String(payload.name || '').trim();
  return {
    turnId,
    activity: {
      id: `${turnId}-raw-mcp-${payload.call_id || sequence}`,
      kind: 'mcp_tool_call',
      label: desktopMobileStatusLabel('mcp_tool_call', status),
      status,
      detail: [server, tool].filter(Boolean).join(' / '),
      toolName: tool,
      error: status === 'failed' ? cleanRawFunctionOutput(outputRecord?.output) : '',
      timestamp,
      startedAt: timing.startedAt,
      completedAt: timing.completedAt,
      durationMs: timing.durationMs,
      sequence
    }
  };
}

function applyPatchInputText(payload = {}) {
  const value = payload.input ?? payload.arguments ?? '';
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  return JSON.stringify(value);
}

function applyPatchFileHeader(line) {
  const match = String(line || '').match(/^\*\*\* (Update|Add|Delete) File: (.+)$/);
  if (!match) {
    return null;
  }
  const kindByAction = {
    Update: 'update',
    Add: 'create',
    Delete: 'delete'
  };
  return {
    kind: kindByAction[match[1]] || 'update',
    path: match[2].trim()
  };
}

function diffStatsFromLines(lines) {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
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

function fileChangesFromApplyPatchInput(input) {
  const text = String(input || '');
  if (!text.includes('*** Begin Patch')) {
    return [];
  }
  const changes = [];
  let current = null;

  const flush = () => {
    if (!current?.path) {
      return;
    }
    const stats = diffStatsFromLines(current.diffLines);
    changes.push({
      path: current.path,
      kind: current.kind,
      additions: stats.additions,
      deletions: stats.deletions,
      unifiedDiff: current.diffLines.join('\n'),
      movePath: current.movePath || null
    });
  };

  for (const line of text.split(/\r?\n/)) {
    const header = applyPatchFileHeader(line);
    if (header) {
      flush();
      current = { ...header, diffLines: [], movePath: null };
      continue;
    }
    if (!current) {
      continue;
    }
    const moveMatch = line.match(/^\*\*\* Move to: (.+)$/);
    if (moveMatch) {
      current.movePath = moveMatch[1].trim();
      continue;
    }
    if (line === '*** End Patch' || line === '*** End of File') {
      continue;
    }
    if (line.startsWith('@@') || line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
      current.diffLines.push(line);
    }
  }
  flush();
  return changes;
}

function fileChangeDetail(fileChanges) {
  return fileChanges
    .map((change) => {
      const stats = [`+${change.additions || 0}`, `-${change.deletions || 0}`].join(' ');
      return [change.path, stats].filter(Boolean).join(' ');
    })
    .join('\n');
}

function rawFileChangeActivityFromCustomCall({ payload, outputRecord, turns, sequence }) {
  if (payload.name !== 'apply_patch') {
    return null;
  }
  const status = rawToolStatus(outputRecord, rawMissingOutputStatusForTurn(turns, turnIdForRawActivityTimestamp(turns, payload.timestamp)));
  const timing = rawFunctionTiming(payload, outputRecord, status);
  const timestamp = timing.timestamp;
  const turnId = turnIdForRawActivityTimestamp(turns, timestamp);
  if (!turnId) {
    return null;
  }
  const fileChanges = fileChangesFromApplyPatchInput(applyPatchInputText(payload));
  return {
    turnId,
    activity: {
      id: `${turnId}-file-change-${payload.call_id || sequence}`,
      kind: 'file_change',
      label: desktopMobileStatusLabel('file_change', status),
      status,
      detail: fileChangeDetail(fileChanges),
      fileChanges,
      timestamp,
      startedAt: timing.startedAt,
      completedAt: timing.completedAt,
      durationMs: timing.durationMs,
      sequence
    }
  };
}

function rawSessionActivitiesFromFunctionCall(payload, outputRecord, turns, sequence) {
  const args = parseJsonObject(payload.arguments);
  const name = String(payload.name || '').trim();
  const namespace = String(payload.namespace || '').trim();
  if (namespace.startsWith('mcp__')) {
    return [rawMcpActivityFromCall({ payload, outputRecord, turns, sequence })].filter(Boolean);
  }
  if (RAW_SESSION_COMMAND_TOOLS.has(name)) {
    const command = name === 'exec_command'
      ? String(args.cmd || args.command || '').trim()
      : name === 'write_stdin'
        ? `write_stdin ${args.session_id || ''}`.trim()
        : name;
    return [
      rawCommandActivityFromCall({
        payload,
        outputRecord,
        turns,
        sequence,
        command,
        toolName: name
      })
    ].filter(Boolean);
  }
  if (name === 'parallel' && Array.isArray(args.tool_uses)) {
    return args.tool_uses
      .map((toolUse, index) => {
        const recipientName = String(toolUse?.recipient_name || '').trim();
        const parameters = toolUse?.parameters || {};
        if (recipientName !== 'functions.exec_command') {
          return null;
        }
        const command = String(parameters.cmd || parameters.command || '').trim();
        return rawCommandActivityFromCall({
          payload: { ...payload, call_id: `${payload.call_id || sequence}-${index}` },
          outputRecord,
          turns,
          sequence: `${sequence}-${index}`,
          command,
          toolName: recipientName
        });
      })
      .filter(Boolean);
  }
  if (name === 'update_plan') {
    return [rawPlanActivityFromCall({ payload, outputRecord, turns, sequence })].filter(Boolean);
  }
  if (namespace === 'web') {
    const status = rawFunctionStatus(outputRecord, rawMissingOutputStatusForTurn(turns, turnIdForRawActivityTimestamp(turns, payload.timestamp)));
    const timing = rawFunctionTiming(payload, outputRecord, status);
    const timestamp = timing.timestamp;
    const turnId = turnIdForRawActivityTimestamp(turns, timestamp);
    if (!turnId) {
      return [];
    }
    return [{
      turnId,
      activity: {
        id: `${turnId}-raw-web-${payload.call_id || sequence}`,
        kind: 'web_search',
        label: desktopMobileStatusLabel('web_search', status),
        status,
        detail: JSON.stringify(args),
        timestamp,
        startedAt: timing.startedAt,
        completedAt: timing.completedAt,
        durationMs: timing.durationMs,
        sequence
      }
    }];
  }
  return [];
}

function normalizeTurnIdFilter(turnIds = null) {
  if (!turnIds) {
    return null;
  }
  const values = turnIds instanceof Set ? [...turnIds] : Array.isArray(turnIds) ? turnIds : [turnIds];
  const normalized = values.map((value) => String(value || '').trim()).filter(Boolean);
  return normalized.length ? new Set(normalized) : null;
}

function activityMatchesTurnFilter(item, turnFilter) {
  if (!turnFilter) {
    return true;
  }
  return turnFilter.has(String(item?.turnId || '').trim());
}

export function rawSessionActivitiesFromJsonl(content, turns = [], { turnIds = null } = {}) {
  const turnFilter = normalizeTurnIdFilter(turnIds);
  const calls = [];
  const customCalls = [];
  const messages = [];
  const compactions = [];
  const outputs = new Map();
  const lines = String(content || '').split(/\r?\n/);
  let sequence = 0;
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
    if (entry?.type === 'compacted') {
      compactions.push({
        timestamp: entry.timestamp || new Date().toISOString(),
        sequence: sequence++
      });
      continue;
    }
    if (entry?.type !== 'response_item') {
      continue;
    }
    const payload = entry.payload || {};
    if (payload.type === 'function_call') {
      calls.push({
        ...payload,
        timestamp: entry.timestamp,
        sequence: sequence++
      });
    } else if (payload.type === 'custom_tool_call') {
      customCalls.push({
        ...payload,
        timestamp: entry.timestamp,
        sequence: sequence++
      });
    } else if (payload.type === 'message') {
      messages.push({
        ...payload,
        timestamp: entry.timestamp,
        sequence: sequence++
      });
    } else if (payload.type === 'function_call_output' && payload.call_id) {
      outputs.set(payload.call_id, {
        output: payload.output,
        timestamp: entry.timestamp
      });
    } else if (payload.type === 'custom_tool_call_output' && payload.call_id) {
      outputs.set(payload.call_id, {
        output: payload.output,
        timestamp: entry.timestamp
      });
    }
  }
  const rawActivities = [];
  for (const payload of messages) {
    const item = rawAgentActivityFromMessage(payload, turns, payload.sequence);
    if (item) {
      rawActivities.push(item);
    }
  }
  for (const payload of compactions) {
    const item = rawContextCompactionActivityFromEntry({ ...payload, turns });
    if (item) {
      rawActivities.push(item);
    }
  }
  for (const payload of calls) {
    const outputRecord = outputs.get(payload.call_id);
    rawActivities.push(...rawSessionActivitiesFromFunctionCall(payload, outputRecord, turns, payload.sequence));
  }
  for (const payload of customCalls) {
    const outputRecord = outputs.get(payload.call_id);
    const item = rawFileChangeActivityFromCustomCall({ payload, outputRecord, turns, sequence: payload.sequence });
    if (item) {
      rawActivities.push(item);
    }
  }
  return applyRawActivitySegments(rawActivities, messages, turns)
    .filter((item) => activityMatchesTurnFilter(item, turnFilter))
    .sort((a, b) => {
      const left = Number(a.activity.sequence);
      const right = Number(b.activity.sequence);
      if (Number.isFinite(left) && Number.isFinite(right) && left !== right) {
        return left - right;
      }
      return new Date(a.activity.timestamp || 0) - new Date(b.activity.timestamp || 0);
    });
}

export async function readRawSessionActivities(filePath, turns, options = {}) {
  if (!filePath) {
    return [];
  }
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return rawSessionActivitiesFromJsonl(content, turns, options);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[sessions] Failed to read raw desktop activity:', error.message);
    }
    return [];
  }
}

export async function readDesktopCollabActivities(filePath, { turnIds = null } = {}) {
  if (!filePath) {
    return [];
  }
  const turnFilter = normalizeTurnIdFilter(turnIds);
  const activitiesByTurn = new Map();
  let currentTurnId = null;

  function ensureTurn(turnId, timestamp) {
    if (!turnId) {
      return null;
    }
    if (!activitiesByTurn.has(turnId)) {
      activitiesByTurn.set(turnId, {
        turnId,
        timestamp,
        agents: new Map()
      });
    }
    return activitiesByTurn.get(turnId);
  }

  try {
    const stream = fsSync.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = entry?.payload || {};
      if (payload.turn_id) {
        currentTurnId = payload.turn_id;
      }
      if (entry.type !== 'event_msg') {
        continue;
      }
      if (payload.type === 'task_started' && payload.turn_id) {
        currentTurnId = payload.turn_id;
        continue;
      }
      if (payload.type === 'collab_agent_spawn_end') {
        if (turnFilter && !turnFilter.has(String(currentTurnId || ''))) {
          continue;
        }
        const state = ensureTurn(currentTurnId, entry.timestamp);
        if (!state || !payload.new_thread_id) {
          continue;
        }
        state.agents.set(payload.new_thread_id, {
          threadId: payload.new_thread_id,
          nickname: payload.new_agent_nickname || '',
          role: payload.new_agent_role || '',
          statusText: payload.status === 'pending_init' ? '运行中' : '打开',
          result: '',
          timestamp: entry.timestamp
        });
        continue;
      }
      if (payload.type === 'collab_waiting_end') {
        const state = ensureTurn(currentTurnId, entry.timestamp);
        if (!state) {
          continue;
        }
        const statuses = Array.isArray(payload.agent_statuses) ? payload.agent_statuses : [];
        for (const item of statuses) {
          const threadId = item.thread_id;
          if (!threadId) {
            continue;
          }
          const status = item.status || {};
          const previous = state.agents.get(threadId) || {};
          state.agents.set(threadId, {
            threadId,
            nickname: item.agent_nickname || previous.nickname || '',
            role: item.agent_role || previous.role || '',
            statusText: agentStatusText(status),
            result: status.completed || status.failed || status.error || '',
            timestamp: entry.timestamp
          });
        }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[sessions] Failed to read collab agent activity:', error.message);
    }
    return [];
  }

  return [...activitiesByTurn.values()]
    .filter((state) => state.agents.size > 0)
    .map((state) => {
      const agents = [...state.agents.values()];
      const running = agents.some((agent) => /运行中|打开/.test(agent.statusText));
      const count = agents.length;
      return {
        turnId: state.turnId,
        activity: {
          id: `${state.turnId}-subagents`,
          kind: 'subagent_activity',
          label: `${count} 个后台智能体（使用 @ 标记智能体）`,
          status: running ? 'running' : 'completed',
          detail: agents.map(collabAgentSummary).join('\n'),
          subAgents: agents,
          timestamp: state.timestamp
        }
      };
    });
}
