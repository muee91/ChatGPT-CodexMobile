/**
 * 可选的运行时调试日志：JSONL 事件、activeRuns 摘要与 UI 开关状态。
 *
 * Keywords: runtime-debug, jsonl, active-runs, observability
 *
 * Exports:
 * - RUNTIME_DEBUG_LOG_RELATIVE — 相对于仓库根的默认日志路径说明。
 * - configureRuntimeDebug / isRuntimeDebugEnabled / getRuntimeDebugPublicState / setRuntimeDebugUiEnabled。
 * - compactActiveRuns / runtimeDebugLine / runtimeDebugStatusActiveRuns。
 *
 * Inward（本模块依赖/组装的关键符号）: node:fs、node:path、环境变量开关。
 *
 * Outward（谁在用/调用场景）: codex-runner、chat-service、/api/status、客户端调试面板。
 *
 * 不负责: 生产级遥测后端。
 */
import fs from 'node:fs';
import path from 'node:path';

function truthy(value) {
  if (value == null || value === '') {
    return false;
  }
  const v = String(value).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

const ENV_ENABLED = truthy(process.env.CODEXMOBILE_RUNTIME_DEBUG);
const LOG_PATH = String(process.env.CODEXMOBILE_RUNTIME_DEBUG_LOG || '').trim();
const STATUS_THROTTLE_MS = Math.max(
  500,
  Number.parseInt(String(process.env.CODEXMOBILE_RUNTIME_DEBUG_STATUS_MS || '3000'), 10) || 3000
);

/** 相对仓库根目录，便于说明与客户端展示 */
export const RUNTIME_DEBUG_LOG_RELATIVE = '.codexmobile/logs/runtime-debug.jsonl';

let settingsEnabled = false;
let settingsFilePath = '';
/** UI 开启时写入的默认日志路径（绝对路径） */
let defaultUiLogPath = '';

let lastStatusLogMs = 0;

export function configureRuntimeDebug({ rootDir }) {
  const root = String(rootDir || '').trim();
  if (!root) {
    return;
  }
  settingsFilePath = path.join(root, '.codexmobile', 'state', 'runtime-debug.json');
  defaultUiLogPath = path.join(root, '.codexmobile', 'logs', 'runtime-debug.jsonl');
  loadRuntimeDebugSettingsFromDisk();
}

function loadRuntimeDebugSettingsFromDisk() {
  if (!settingsFilePath) {
    settingsEnabled = false;
    return;
  }
  try {
    const raw = fs.readFileSync(settingsFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    settingsEnabled = Boolean(parsed.enabled);
  } catch {
    settingsEnabled = false;
  }
}

export function isRuntimeDebugEnabled() {
  return ENV_ENABLED || settingsEnabled;
}

export function getRuntimeDebugPublicState() {
  return {
    envEnabled: ENV_ENABLED,
    uiEnabled: settingsEnabled,
    enabled: isRuntimeDebugEnabled(),
    logRelativePath: RUNTIME_DEBUG_LOG_RELATIVE
  };
}

export function setRuntimeDebugUiEnabled(enabled) {
  if (!settingsFilePath) {
    console.warn('[runtime-debug] configureRuntimeDebug was not called; cannot persist UI toggle');
    return;
  }
  settingsEnabled = Boolean(enabled);
  const dir = path.dirname(settingsFilePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    settingsFilePath,
    JSON.stringify(
      {
        enabled: settingsEnabled,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  );
  if (settingsEnabled && defaultUiLogPath) {
    fs.mkdirSync(path.dirname(defaultUiLogPath), { recursive: true });
    runtimeDebugLine('runtimeDebug.uiEnabled', { source: 'settings' });
  }
}

function resolveLogFilePath() {
  if (LOG_PATH) {
    return LOG_PATH;
  }
  if (settingsEnabled && defaultUiLogPath) {
    return defaultUiLogPath;
  }
  return '';
}

export function compactActiveRuns(runs) {
  if (!Array.isArray(runs)) {
    return [];
  }
  return runs.map((r) => ({
    sessionId: r.sessionId || null,
    turnId: r.turnId || null,
    previousSessionId: r.previousSessionId || null,
    source: r.source || null,
    status: r.status || null,
    steerable: r.steerable
  }));
}

export function runtimeDebugLine(event, data = {}) {
  if (!isRuntimeDebugEnabled()) {
    return;
  }
  const record = { t: new Date().toISOString(), event, ...data };
  const line = JSON.stringify(record);
  console.log(`[runtime-debug] ${line}`);
  const filePath = resolveLogFilePath();
  if (!filePath) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${line}\n`, 'utf8');
  } catch (err) {
    console.warn('[runtime-debug] append failed:', err.message);
  }
}

/** 节流记录 /api/status 聚合后的 activeRuns，避免轮询刷爆日志 */
export function runtimeDebugStatusActiveRuns(activeRuns) {
  if (!isRuntimeDebugEnabled() || !Array.isArray(activeRuns)) {
    return;
  }
  const now = Date.now();
  if (now - lastStatusLogMs < STATUS_THROTTLE_MS) {
    return;
  }
  lastStatusLogMs = now;
  runtimeDebugLine('status.activeRuns', {
    count: activeRuns.length,
    runs: compactActiveRuns(activeRuns)
  });
}
