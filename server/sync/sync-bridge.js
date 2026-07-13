/**
 * 同步桥：接收旧广播 payload，产出统一 SyncEvent 与最新 sync-state。
 *
 * Keywords: sync-bridge, legacy-payload, sync-event, broadcast
 *
 * Exports:
 * - createSyncBridge — 创建旧事件到统一同步事件的转换与状态桥。
 *
 * Inward（本模块依赖/组装的关键符号）: sync-events、sync-store、sync-projector。
 *
 * Outward（谁在用/调用场景）: server/index.js 的 broadcast 与 WebSocket connected 初始包。
 *
 * 不负责: 具体 WebSocket socket 管理。
 */

import { normalizeLegacyPayloadToSyncEvents } from './sync-events.js';
import { createSyncStore } from './sync-store.js';
import { syncEventPayload, syncStatePayload } from './sync-projector.js';

export function createSyncBridge(options = {}) {
  const store = createSyncStore(options);

  function consumeLegacyPayload(payload = {}) {
    const events = normalizeLegacyPayloadToSyncEvents(payload);
    if (!events.length) {
      return [];
    }
    return events.map((event) => {
      const snapshot = store.applyEvent(event);
      return syncEventPayload(event, snapshot);
    });
  }

  function publicState() {
    return store.snapshot();
  }

  function publicStatePayload() {
    return syncStatePayload(publicState());
  }

  return {
    consumeLegacyPayload,
    publicState,
    publicStatePayload,
    setBridgeStatus: store.setBridgeStatus
  };
}
