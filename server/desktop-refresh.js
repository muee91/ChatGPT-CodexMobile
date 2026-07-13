/**
 * 实验性 Codex.app 桌面刷新与手动桌面接续：自动刷新走 route bounce，手动接续强制重启到目标线程。
 *
 * Keywords: desktop-refresh, Codex.app, route-bounce, desktop-handoff, restart
 *
 * Exports:
 * - configureDesktopRefresh — 配置状态文件根目录与可注入执行器。
 * - getDesktopRefreshPublicState / setDesktopRefreshEnabled — 对外状态与 UI 开关持久化。
 * - triggerDesktopRefreshForThread — 在 headless 线程完成后尝试刷新桌面 App。
 * - openDesktopThread — 用户显式点击“回到桌面继续”时重启桌面端并打开当前线程。
 *
 * Inward（本模块依赖/组装的关键符号）: node:child_process、node:fs、state JSON、macOS open/osascript/pkill。
 *
 * Outward（谁在用/调用场景）: server/index 状态接口、chat-delivery completion hook。
 *
 * 不负责: Codex Desktop 真实时订阅；这里只做可选的刷新/重启接续 workaround。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_BUNDLE_ID = 'com.openai.codex';
const DEFAULT_APP_PATH = '/Applications/Codex.app';
const DEFAULT_PROCESS_NAME = 'Codex';
const BOUNCE_URL = 'codex://settings';

let settingsFilePath = '';
let settingsEnabled = false;
let runtimePlatform = process.platform;
let routeExecutor = defaultRouteExecutor;
let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let bundleId = DEFAULT_BUNDLE_ID;
let appPath = DEFAULT_APP_PATH;
let processName = DEFAULT_PROCESS_NAME;
let lastTriggeredAt = null;
let lastError = null;

function isSupportedPlatform() {
  return runtimePlatform === 'darwin';
}

function readSettingsFromDisk() {
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

function writeSettingsToDisk() {
  if (!settingsFilePath) {
    console.warn('[desktop-refresh] configureDesktopRefresh was not called; cannot persist UI toggle');
    return;
  }
  fs.mkdirSync(path.dirname(settingsFilePath), { recursive: true });
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
}

export function configureDesktopRefresh({
  rootDir,
  platform = process.platform,
  executor = defaultRouteExecutor,
  sleep: sleepImpl = sleep,
  codexBundleId = DEFAULT_BUNDLE_ID,
  codexAppPath = DEFAULT_APP_PATH,
  codexProcessName = DEFAULT_PROCESS_NAME
} = {}) {
  const root = String(rootDir || '').trim();
  settingsFilePath = root ? path.join(root, '.codexmobile', 'state', 'desktop-refresh.json') : '';
  runtimePlatform = platform;
  routeExecutor = executor;
  sleep = sleepImpl;
  bundleId = codexBundleId || DEFAULT_BUNDLE_ID;
  appPath = codexAppPath || DEFAULT_APP_PATH;
  processName = codexProcessName || DEFAULT_PROCESS_NAME;
  lastTriggeredAt = null;
  lastError = null;
  readSettingsFromDisk();
}

export function getDesktopRefreshPublicState() {
  return {
    enabled: settingsEnabled,
    supported: isSupportedPlatform(),
    experimental: true,
    mode: 'completion',
    lastTriggeredAt,
    lastError
  };
}

export function setDesktopRefreshEnabled(enabled) {
  settingsEnabled = Boolean(enabled);
  writeSettingsToDisk();
  return getDesktopRefreshPublicState();
}

async function bounceToDesktopThread(threadId, { reason = 'desktop-refresh', delayMs = 180, requireEnabled = true } = {}) {
  const id = String(threadId || '').trim();
  if (requireEnabled && !settingsEnabled) {
    return { triggered: false, reason: 'desktop-refresh-disabled' };
  }
  if (!isSupportedPlatform()) {
    return { triggered: false, reason: 'desktop-refresh-unsupported-platform' };
  }
  if (!id) {
    return { triggered: false, reason: 'desktop-refresh-missing-thread' };
  }

  const targetUrl = `codex://threads/${encodeURIComponent(id)}`;
  try {
    await routeExecutor({ url: BOUNCE_URL, bundleId, appPath, phase: 'bounce', reason });
    await sleep(Math.max(0, Number(delayMs) || 0));
    await routeExecutor({ url: targetUrl, bundleId, appPath, phase: 'target', reason });
    lastTriggeredAt = new Date().toISOString();
    lastError = null;
    return { triggered: true, method: 'deep-link-bounce', reason, targetUrl };
  } catch (error) {
    lastError = error?.message || '桌面刷新失败';
    return {
      triggered: false,
      method: 'deep-link-bounce',
      reason: 'desktop-refresh-failed',
      error: lastError,
      targetUrl
    };
  }
}

export async function triggerDesktopRefreshForThread(threadId, { reason = 'desktop-refresh', delayMs = 180 } = {}) {
  const id = String(threadId || '').trim();
  if (!settingsEnabled) {
    return { triggered: false, method: 'deep-link-direct', reason: 'desktop-refresh-disabled' };
  }
  if (!isSupportedPlatform()) {
    return { triggered: false, method: 'deep-link-direct', reason: 'desktop-refresh-unsupported-platform' };
  }
  if (!id) {
    return { triggered: false, method: 'deep-link-direct', reason: 'desktop-refresh-missing-thread' };
  }
  const targetUrl = `codex://threads/${encodeURIComponent(id)}`;
  try {
    await routeExecutor({ url: targetUrl, bundleId, appPath, phase: 'direct', reason });
    lastTriggeredAt = new Date().toISOString();
    lastError = null;
    return { triggered: true, method: 'deep-link-direct', reason, targetUrl };
  } catch (error) {
    lastError = error?.message || '桌面直达刷新失败';
    return bounceToDesktopThread(id, { reason, delayMs, requireEnabled: true });
  }
}

export async function openDesktopThread(threadId, { reason = 'desktop-handoff', delayMs = 180 } = {}) {
  const id = String(threadId || '').trim();
  if (!isSupportedPlatform()) {
    return { triggered: false, reason: 'desktop-refresh-unsupported-platform' };
  }
  if (!id) {
    return { triggered: false, reason: 'desktop-refresh-missing-thread' };
  }

  const targetUrl = `codex://threads/${encodeURIComponent(id)}`;
  try {
    await routeExecutor({ bundleId, appPath, processName, phase: 'quit', reason });
    await sleep(Math.max(0, Number(delayMs) || 0));
    await routeExecutor({ url: targetUrl, bundleId, appPath, processName, phase: 'target', reason });
    lastTriggeredAt = new Date().toISOString();
    lastError = null;
    return { triggered: true, method: 'manual-restart', reason, targetUrl, restarted: true };
  } catch (error) {
    lastError = error?.message || '桌面端重启接续失败';
    return {
      triggered: false,
      method: 'manual-restart',
      reason: 'desktop-refresh-failed',
      error: lastError,
      targetUrl,
      restarted: false
    };
  }
}

async function defaultRouteExecutor({ url, bundleId: targetBundleId, appPath: targetAppPath, processName: targetProcessName, phase }) {
  if (phase === 'quit') {
    await quitCodexDesktop(targetBundleId, targetProcessName);
    return;
  }
  try {
    await execFileAsync('open', ['-b', targetBundleId, url], { timeout: 3000 });
  } catch {
    await execFileAsync('open', ['-a', targetAppPath, url], { timeout: 3000 });
  }
}

async function quitCodexDesktop(targetBundleId, targetProcessName) {
  await execFileAsync('osascript', [
    '-e',
    `tell application id "${String(targetBundleId).replaceAll('"', '\\"')}" to quit`
  ], { timeout: 3000 }).catch(() => null);

  await execFileAsync('pkill', ['-x', targetProcessName || DEFAULT_PROCESS_NAME], { timeout: 3000 }).catch((error) => {
    if (error?.code === 1) {
      return null;
    }
    throw error;
  });
}
