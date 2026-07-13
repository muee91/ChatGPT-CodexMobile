/**
 * 顶部菜单“回到桌面继续”的文案、禁用态与安全边界推导。
 *
 * Keywords: desktop-handoff, topbar, session-state, runtime
 *
 * Exports:
 * - desktopHandoffMenuState — 根据当前会话和运行态返回菜单项状态。
 *
 * Inward: session-utils 的草稿判断。
 *
 * Outward: TopBar 菜单与对应单测。
 *
 * 不负责: 真实打开 Codex.app；后端 API 执行 deep link。
 */

import { isDraftSession } from './app/session-utils.js';

const ACTIVE_RUNTIME_STATUSES = new Set(['running', 'queued']);

export function desktopHandoffMenuState({
  selectedSession = null,
  selectedRuntime = null,
  running = false,
  supported = true,
  pending = false
} = {}) {
  const runtimeStatus = String(selectedRuntime?.status || '').toLowerCase();
  const active = Boolean(running || ACTIVE_RUNTIME_STATUSES.has(runtimeStatus));

  if (pending) {
    return {
      disabled: true,
      label: '正在重启桌面端',
      reason: '正在重启桌面端 Codex 并打开当前对话。'
    };
  }

  if (!supported) {
    return {
      disabled: true,
      label: '桌面端不可用',
      reason: '当前平台不支持通过 Codex.app deep link 回到桌面。'
    };
  }

  if (!selectedSession?.id || isDraftSession(selectedSession)) {
    return {
      disabled: true,
      label: '暂无可打开的对话',
      reason: '请先打开一个已创建的对话。'
    };
  }

  if (active) {
    return {
      disabled: true,
      label: '执行完成后回到桌面',
      reason: '当前对话执行中，完成后可回到桌面继续。'
    };
  }

  return {
    disabled: false,
    label: '回到桌面继续',
    reason: '重启桌面端 Codex 并打开当前对话。'
  };
}
