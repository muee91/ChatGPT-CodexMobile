/**
 * 运行中的 Activity 进度气泡：内联展示 runtime 状态和实时步骤。
 *
 * Keywords: activity live, progress bubble, runtime
 *
 * Exports:
 * - ActivityLiveProgress — 将 runtime 状态和 activity steps 渲染为轻量对话进度。
 * - liveProgressDurationStartedAt — 选择实时计时的稳定起点。
 *
 * Inward: session-utils、activity-model、activity-timeline-projection、ActivityTimeline。
 *
 * Outward: ChatPane.jsx。
 */

import { useEffect, useState } from 'react';
import { activityMessageIsRunning } from './activity-card-state.js';
import { isVisibleActivityStep, shouldRenderActivityMessageInChat } from './activity-model.js';
import { ActivityTimeline } from './ActivityTimeline.jsx';
import { projectActivityView } from './activity-timeline-projection.js';
import { formatDuration } from '../app/session-utils.js';

export function liveProgressDurationStartedAt(message = {}, runtimeStartedAt = null) {
  return message?.startedAt || message?.timestamp || runtimeStartedAt || '';
}

export function ActivityLiveProgress({ message, running = false, startedAt = null, now = Date.now() }) {
  if (!shouldRenderActivityMessageInChat(message)) {
    return null;
  }
  const activities = message.activities || [];
  const visibleSteps = activities.filter((activity) => isVisibleActivityStep(activity, 'running'));
  const { timeline } = projectActivityView(visibleSteps, { running: true });
  if (!timeline.length) {
    return null;
  }
  const active = running || activityMessageIsRunning(message);
  const [localNow, setLocalNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    setLocalNow(Date.now());
    const timer = window.setInterval(() => setLocalNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  const durationStartedAt = liveProgressDurationStartedAt(message, startedAt);
  const displayNow = active ? Math.max(Number(now) || 0, localNow) : now;
  const duration = durationStartedAt ? formatDuration(durationStartedAt, displayNow) : '';
  return (
    <div className="message-row is-assistant is-activity-live">
      <div className="message-stack">
        <div className="message-bubble activity-live-progress-bubble">
          <div className="activity-live-status" role={active ? 'status' : undefined} aria-live={active ? 'polite' : undefined}>
            <span className={`activity-live-status-dot ${active ? 'is-running' : ''}`} aria-hidden="true" />
            <span className="activity-live-status-title">执行中</span>
            {duration ? <span className="activity-live-status-duration">{duration}</span> : null}
          </div>
          <ActivityTimeline timeline={timeline} detailsOpen={false} />
        </div>
      </div>
    </div>
  );
}
