/**
 * WebSocket 存活探测：及时终止移动网络切换后遗留的半开连接。
 *
 * Keywords: websocket, heartbeat, reconnect, mobile
 *
 * Exports:
 * - pulseWebSocketClients / startWebSocketHeartbeat — 心跳轮次与定时器。
 *
 * Inward: ws WebSocketServer.clients。
 *
 * Outward: server/index.js。
 *
 * 不负责: 客户端重连策略与鉴权。
 */

const WEBSOCKET_OPEN = 1;

export function pulseWebSocketClients(clients = []) {
  let pinged = 0;
  let terminated = 0;
  for (const socket of clients) {
    if (!socket || socket.readyState !== WEBSOCKET_OPEN) {
      continue;
    }
    if (socket.isAlive === false) {
      socket.terminate?.();
      terminated += 1;
      continue;
    }
    socket.isAlive = false;
    try {
      socket.ping?.();
      pinged += 1;
    } catch {
      socket.terminate?.();
      terminated += 1;
    }
  }
  return { pinged, terminated };
}

export function startWebSocketHeartbeat(wss, {
  intervalMs = 25_000,
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval
} = {}) {
  const timer = setIntervalImpl(() => {
    pulseWebSocketClients(wss?.clients || []);
  }, Math.max(1_000, Number(intervalMs) || 25_000));
  timer?.unref?.();
  return () => clearIntervalImpl(timer);
}
