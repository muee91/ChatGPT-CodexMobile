/**
 * 监听桌面端 IPC 广播，把标题等轻量状态变化同步进 CodexMobile。
 *
 * Keywords: desktop-ipc, broadcast-listener, title-sync, reconnect
 *
 * Exports:
 * - createDesktopIpcBroadcastListener — 创建可启动/停止的 IPC 广播监听器。
 *
 * Inward（本模块依赖/组装的关键符号）: desktop-ipc-client。
 *
 * Outward（谁在用/调用场景）: server/index 启动时接入桌面端广播。
 *
 * 不负责: 业务状态落盘。
 */
import { DesktopIpcClient } from './desktop-ipc-client.js';

export function createDesktopIpcBroadcastListener({
  clientType = 'codexmobile-broadcast-listener',
  reconnectMs = 2000,
  timeoutMs = 1500,
  onBroadcast = null,
  logger = console
} = {}) {
  let client = null;
  let stopped = false;
  let reconnectTimer = null;
  let lastError = '';

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) {
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectMs);
    if (typeof reconnectTimer.unref === 'function') {
      reconnectTimer.unref();
    }
  }

  async function connect() {
    if (stopped) {
      return;
    }
    client?.close();
    client = new DesktopIpcClient({
      clientType,
      onBroadcast: (message) => {
        Promise.resolve(onBroadcast?.(message)).catch((error) => {
          logger.warn?.('[desktop-ipc] broadcast handler failed:', error.message);
        });
      },
      onClose: scheduleReconnect
    });
    try {
      await client.connect({ timeoutMs });
      lastError = '';
    } catch (error) {
      const message = error.message || '桌面端 IPC 监听连接失败';
      if (message !== lastError) {
        logger.warn?.('[desktop-ipc] broadcast listener unavailable:', message);
        lastError = message;
      }
      client?.close();
      client = null;
      scheduleReconnect();
    }
  }

  return {
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      clearReconnectTimer();
      client?.close();
      client = null;
    }
  };
}
