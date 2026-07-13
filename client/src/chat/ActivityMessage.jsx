/**
 * 活动类消息气泡：折叠摘要、时长与执行时间线。
 *
 * Keywords: activity message, timeline, running
 *
 * Exports:
 * - ActivityMessage — 渲染单条 activity role 消息或 null。
 *
 * Inward: session-utils、activity-model、activity-timeline-projection、ActivityTimeline。
 *
 * Outward: ChatMessage.jsx
 */

import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDuration, formatDurationMs } from '../app/session-utils.js';
import { activityCardHeadline, effectiveActivityMessageIsRunning, initialActivityCardOpenState, nextActivityCardOpenState } from './activity-card-state.js';
import { isVisibleActivityStep, shouldRenderActivityMessageInChat } from './activity-model.js';
import { ActivityTimeline } from './ActivityTimeline.jsx';
import { projectActivityView } from './activity-timeline-projection.js';

export function ActivityMessage({ message, now = Date.now(), forceRunning = false, forceOpen = false }) {
  if (!shouldRenderActivityMessageInChat(message)) {
    return null;
  }
  const activities = message.activities || [];
  const running = effectiveActivityMessageIsRunning({ message, activities, forceRunning });
  const failed = message.status === 'failed';
  const visibleSteps = activities.filter((activity) => isVisibleActivityStep(activity, message.status));
  const { timeRange, timeline } = projectActivityView(visibleSteps, { running });
  const hasProcess = timeline.length > 0;
  const canExpandTimeline = hasProcess && !running;
  const shouldForceOpen = Boolean(forceOpen || message.forceOpen);
  const [open, setOpen] = useState(() => initialActivityCardOpenState({ running, hasProcess, forceOpen: shouldForceOpen }));
  const startedAt = message.startedAt || timeRange.startedAt || message.timestamp;
  const endedAt = running ? now : message.completedAt || timeRange.endedAt || message.timestamp || now;
  const rangeDurationMs = new Date(endedAt || now).getTime() - new Date(startedAt || endedAt || now).getTime();
  const safeRangeDurationMs = Number.isFinite(rangeDurationMs) && rangeDurationMs > 0 ? rangeDurationMs : 0;
  const explicitDurationMs = Number(message.durationMs);
  const completedDurationMs = Math.max(
    Number.isFinite(explicitDurationMs) && explicitDurationMs > 0 ? explicitDurationMs : 0,
    safeRangeDurationMs
  );
  const duration = !running
    ? formatDurationMs(completedDurationMs) || formatDuration(startedAt, endedAt)
    : formatDuration(startedAt, endedAt);
  const headline = activityCardHeadline({ message, activities: visibleSteps, running });

  useEffect(() => {
    setOpen((previousOpen) => nextActivityCardOpenState({ previousOpen, running, hasProcess, forceOpen: shouldForceOpen }));
  }, [message.id, running, hasProcess, shouldForceOpen]);

  return (
    <div className="message-row is-activity">
      <div
        className={[
          'message-bubble activity-bubble',
          failed ? 'is-failed' : '',
          open ? 'is-open' : 'is-folded'
        ].filter(Boolean).join(' ')}
      >
        <button
          type="button"
          className="activity-summary"
          aria-expanded={canExpandTimeline ? open : undefined}
          disabled={!canExpandTimeline}
          onClick={() => {
            if (!canExpandTimeline) {
              return;
            }
            setOpen((value) => !value);
          }}
        >
          <span className={`activity-summary-dot ${running ? 'is-running' : ''}`} aria-hidden="true" />
          <span className="activity-summary-title">{headline}</span>
          {duration ? <span className="activity-summary-duration">{duration}</span> : null}
          {canExpandTimeline ? <ChevronDown className={`activity-chevron ${open ? 'is-open' : ''}`} size={15} /> : null}
        </button>
        {open && canExpandTimeline ? (
          <ActivityTimeline
            timeline={timeline}
            detailsOpen={open}
          />
        ) : null}
      </div>
    </div>
  );
}
