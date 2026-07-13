/**
 * 聊天滚动钉底：判断是否在底部附近及是否应跟随输出滚动。
 *
 * Keywords: chat, scroll, pinned-bottom, follow-output
 *
 * Exports:
 * - CHAT_BOTTOM_THRESHOLD_PX — 距底阈值像素。
 * - isNearChatBottom — 当前滚动位置是否贴近底部。
 * - shouldFollowChatOutput — 是否继续自动滚到底。
 *
 * Inward: 无。
 *
 * Outward: Chat 面板与 Composer 联动。
 */

export const CHAT_BOTTOM_THRESHOLD_PX = 96;

export function isNearChatBottom(pane, threshold = CHAT_BOTTOM_THRESHOLD_PX) {
  if (!pane) {
    return true;
  }
  const scrollHeight = Number(pane.scrollHeight) || 0;
  const scrollTop = Number(pane.scrollTop) || 0;
  const clientHeight = Number(pane.clientHeight) || 0;
  return scrollHeight - scrollTop - clientHeight < threshold;
}

export function shouldFollowChatOutput({ pinnedToBottom, pinnedBeforeUpdate = false, force = false }) {
  return Boolean(force || pinnedToBottom || pinnedBeforeUpdate);
}
