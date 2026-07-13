/**
 * 客户端 runtime 调试开关：读写 localStorage/sessionStorage，并在开启时向控制台打出结构化调试事件。
 *
 * Keywords: runtime-debug, localStorage, client-logging
 *
 * Exports:
 * - `RUNTIME_DEBUG_STORAGE_KEY` — 与本地开关共用的 key 常量。
 * - `setClientRuntimeDebugEnabled` / `isClientRuntimeDebug` — 开关读写。
 * - `clientRuntimeDebug` — 条件化 `console.log` 输出。
 *
 * Inward: 浏览器 `window` / `localStorage` / `sessionStorage`。
 *
 * Outward: `useTurnRuntime`、`Drawer` 设置项、`session-live-refresh` 等可选埋点。
 */

const STORAGE_KEY = 'codexmobile.runtimeDebug';

export const RUNTIME_DEBUG_STORAGE_KEY = STORAGE_KEY;

export function setClientRuntimeDebugEnabled(enabled) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (enabled) {
      localStorage.setItem(STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

export function isClientRuntimeDebug() {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    if (window.__CODEXMOBILE_RUNTIME_DEBUG__ === true) {
      return true;
    }
    return (
      sessionStorage.getItem(STORAGE_KEY) === '1' || localStorage.getItem(STORAGE_KEY) === '1'
    );
  } catch {
    return false;
  }
}

export function clientRuntimeDebug(event, data = {}) {
  if (!isClientRuntimeDebug()) {
    return;
  }
  const record = { t: new Date().toISOString(), event, ...data };
  console.log(`[runtime-debug][client] ${JSON.stringify(record)}`);
}
