/**
 * 同步状态选择器：从统一 runtime map 中为聊天区、侧边栏和输入框提取展示状态。
 *
 * Keywords: sync-selectors, runtime, composer, sidebar
 *
 * Exports:
 * - selectRuntimeForSession — 获取会话当前 live runtime。
 * - syncRunningByIdFromRuntime — 将 runtime map 转为兼容旧组件的 runningById。
 *
 * Inward（本模块依赖/组装的关键符号）: sync-reducer run key 工具。
 *
 * Outward（谁在用/调用场景）: App/useSyncSocket 以及后续删除旧 runtime 工具时迁移使用。
 *
 * 不负责: 消息时间线与 Markdown 渲染。
 */

import { syncEventRunKeys } from './sync-reducer.js';

export function selectRuntimeForSession(session = null, runtimeById = {}) {
  if (!session) {
    return null;
  }
  const keys = [session.id, session.turnId, session.previousSessionId].filter(Boolean).map(String);
  return keys.map((key) => runtimeById?.[key]).find(Boolean) || null;
}

export function syncRunningByIdFromRuntime(runtimeById = {}) {
  const next = {};
  for (const [key, runtime] of Object.entries(runtimeById || {})) {
    if (runtime?.status === 'running' || runtime?.status === 'queued') {
      next[key] = true;
    }
  }
  return next;
}

export function eventRunningById(event = {}) {
  const next = {};
  for (const key of syncEventRunKeys(event)) {
    next[key] = true;
  }
  return next;
}
