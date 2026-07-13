/**
 * 活动时间线占位项判断：隐藏尚无实质内容的泛型「一步操作」占位。
 *
 * Keywords: activity, timeline, placeholder, tool-step
 *
 * Exports:
 * - isPlaceholderTimelineItem — 是否为可隐藏的占位 tool 项。
 *
 * Inward: 无。
 *
 * Outward: 活动卡片 / 时间线折叠展示。
 */

export function isPlaceholderTimelineItem(item = null) {
  if (!item || item.type !== 'tool') {
    return false;
  }
  const label = String(item.label || '').replace(/\s+/g, ' ').trim();
  const hasDetail = Boolean(
    String(item.detail || '').trim() ||
    String(item.command || '').trim() ||
    String(item.output || '').trim() ||
    String(item.error || '').trim() ||
    (Array.isArray(item.subAgents) && item.subAgents.length)
  );
  if (hasDetail) {
    return false;
  }
  return /^(正在完成一步操作|已完成一步操作|这一步操作失败|调用工具)$/.test(label);
}
