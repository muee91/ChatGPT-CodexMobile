/**
 * 同步投影器：把 SyncEvent 与 store snapshot 包装成前端可消费的 WS payload。
 *
 * Keywords: sync-projector, websocket, sync-state
 *
 * Exports:
 * - syncEventPayload — 生成单个 sync-event payload。
 * - syncStatePayload — 生成完整 sync-state payload。
 *
 * Inward（本模块依赖/组装的关键符号）: 无外部业务依赖。
 *
 * Outward（谁在用/调用场景）: sync-bridge 与 WebSocket connected 初始状态。
 *
 * 不负责: 事件归一化和状态变更。
 */

export function syncEventPayload(event, snapshot = null) {
  return {
    type: 'sync-event',
    event,
    state: snapshot || null,
    timestamp: event?.timestamp || new Date().toISOString()
  };
}

export function syncStatePayload(snapshot = {}) {
  return {
    type: 'sync-state',
    state: snapshot,
    timestamp: new Date().toISOString()
  };
}
