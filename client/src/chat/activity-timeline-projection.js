/**
 * 将 activity steps 投影为带工具爆发展开的 timeline，并返回时间范围与文件汇总。
 *
 * Keywords: activity projection, tool burst, timeline
 *
 * Exports:
 * - TOOL_BURST_VISIBLE_COUNT — 单次可见工具调用条数常量。
 * - projectActivityView、projectActivityTimeline — 组装视图数据。
 *
 * Inward: ./activity-timeline-model.js
 *
 * Outward: ActivityMessage.jsx
 */

import {
  activityTimeRange,
  buildActivityFileSummary,
  buildActivityTimeline
} from './activity-timeline-model.js';

export const TOOL_BURST_VISIBLE_COUNT = 5;

export function projectActivityView(steps, { running = false, burstVisibleCount = TOOL_BURST_VISIBLE_COUNT } = {}) {
  const sourceSteps = Array.isArray(steps) ? steps : [];
  const timeline = buildActivityTimeline(sourceSteps, running);
  return {
    timeRange: activityTimeRange(sourceSteps),
    timeline: projectActivityTimeline(timeline, { burstVisibleCount }),
    fileSummary: buildActivityFileSummary(sourceSteps)
  };
}

export function projectActivityTimeline(timeline, { burstVisibleCount = TOOL_BURST_VISIBLE_COUNT } = {}) {
  const visibleCount = Math.max(1, Number(burstVisibleCount) || TOOL_BURST_VISIBLE_COUNT);
  return (Array.isArray(timeline) ? timeline : []).map((item) => {
    if (!shouldProjectToolBurst(item, visibleCount)) {
      return item;
    }
    const items = item.items || [];
    return {
      ...item,
      type: 'metaBurst',
      visibleItems: items.slice(0, visibleCount),
      overflowItems: items.slice(visibleCount),
      hiddenCount: Math.max(0, items.length - visibleCount)
    };
  });
}

function shouldProjectToolBurst(item, visibleCount) {
  if (!item || item.type !== 'meta' || item.metaType === 'subagent') {
    return false;
  }
  const items = Array.isArray(item.items) ? item.items : [];
  return items.length > visibleCount;
}
