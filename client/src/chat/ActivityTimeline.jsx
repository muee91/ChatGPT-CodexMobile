/**
 * 渲染活动任务时间线：按桌面端节奏保留“输出片段 -> 工具过程”的交替片段。
 *
 * Keywords: activity timeline, lucide, markdown
 *
 * Exports:
 * - ActivityTimeline — timeline 列表。
 *
 * Inward: activity-timeline-model、MarkdownContent。
 *
 * Outward: ActivityMessage.jsx
 */

import { BookOpenCheck, Bot, FileText, Pencil, Search, SquareTerminal } from 'lucide-react';
import {
  activityTimelineSegments,
  activityBodyItemsForDisplay,
  activityDetailText,
  activityMetaShouldOpen,
  activityStepDetailTitle,
  activityStepDetailShouldOpen,
  isSkillActivityStep
} from './activity-timeline-model.js';
import { MarkdownContent } from './MarkdownContent.jsx';

export function ActivityTimeline({ timeline, detailsOpen = false }) {
  if (!timeline?.length) {
    return null;
  }
  const segments = activityTimelineSegments(timeline);
  return (
    <div className="activity-timeline" aria-label="任务进度">
      {segments.map((segment) => (
        <ActivityTimelineSegment key={segment.id} segment={segment} detailsOpen={detailsOpen} />
      ))}
    </div>
  );
}

function ActivityTimelineSegment({ segment, detailsOpen = false }) {
  if (segment.type === 'standalone') {
    return <ActivityTimelineItem item={segment.item} detailsOpen={detailsOpen} />;
  }
  const hasText = Boolean(segment.textItem);
  const hasTools = Boolean(segment.items?.length);
  return (
    <section className={`activity-segment ${hasText ? 'has-text' : ''} ${hasTools ? 'has-tools' : ''}`}>
      <span className="activity-segment-node" aria-hidden="true" />
      {hasText ? (
        <div className="activity-segment-text">
          <ActivityTimelineItem item={segment.textItem} detailsOpen={detailsOpen} />
        </div>
      ) : null}
      {hasTools ? (
        <div className="activity-segment-tools">
          {segment.items.map((item) => (
            <ActivityTimelineItem key={item.id} item={item} detailsOpen={detailsOpen} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ActivityTimelineItem({ item, detailsOpen = false }) {
  if (item.type === 'text') {
    return (
      <MarkdownContent
        className="message-content activity-markdown activity-text"
        text={item.text}
      />
    );
  }
  if (item.type === 'live') {
    return (
      <div className={`activity-live is-${item.liveType || 'step'} ${item.status === 'running' ? 'is-running' : ''}`}>
        <span className="activity-live-dot" />
        <span>{item.text}</span>
      </div>
    );
  }
  if (item.type === 'divider') {
    return (
      <div className="activity-divider">
        <span>{item.text}</span>
      </div>
    );
  }
  if (item.metaType === 'subagent') {
    return <SubagentActivityBlock item={item} detailsOpen={detailsOpen} />;
  }
  return <MetaActivityBlock item={item} detailsOpen={detailsOpen} />;
}

function MetaActivityBlock({ item, detailsOpen = false }) {
  const visibleItems = item.type === 'metaBurst' ? item.visibleItems || [] : item.items || [];
  const overflowItems = item.type === 'metaBurst' ? item.overflowItems || [] : [];
  const allItems = item.items || visibleItems;
  const running = allItems.some((step) => step.status === 'running' || step.status === 'queued');
  const { visibleBodyItems, overflowBodyItems } = activityBodyItemsForDisplay(visibleItems, overflowItems);
  const shouldOpen = activityMetaShouldOpen(item, { forceOpen: detailsOpen });

  if (!visibleBodyItems.length && !overflowBodyItems.length) {
    return (
      <div className={`activity-meta ${running ? 'is-running' : ''}`}>
        <div className="activity-meta-summary">
          {activityMetaIcon(item)}
          <span>{item.title}</span>
        </div>
      </div>
    );
  }

  return (
    <details className={`activity-meta ${running ? 'is-running' : ''}`} open={shouldOpen}>
      <summary className="activity-meta-summary">
        {activityMetaIcon(item)}
        <span>{item.title}</span>
      </summary>
      <div className="activity-meta-body">
        {visibleBodyItems.map((step) => (
          <ActivityStepDetail key={step.id} step={step} detailsOpen={detailsOpen} />
        ))}
        {overflowBodyItems.length ? (
          <details className="activity-overflow">
            <summary>还有 {overflowBodyItems.length} 条过程</summary>
            <div className="activity-meta-body">
              {overflowBodyItems.map((step) => (
                <ActivityStepDetail key={step.id} step={step} detailsOpen={detailsOpen} />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </details>
  );
}

function ActivityStepDetail({ step, detailsOpen = false }) {
  const detail = activityDetailText(step);
  const isCommand = step.type === 'command' || Boolean(step.command);
  if (isCommand) {
    const command = step.command || detail;
    const output = step.output || step.error || '';
    const failed = step.status === 'failed';
    const running = step.status === 'running' || step.status === 'queued';
    const title = activityStepDetailTitle(step);
    const shellText = [`$ ${command}`, output].filter(Boolean).join('\n\n');
    const statusText = failed && step.exitCode !== undefined && step.exitCode !== null
      ? `退出码 ${step.exitCode}`
      : failed
        ? '失败'
        : running
          ? '运行中'
          : '成功';
    return (
      <details
        className={`activity-command-detail ${failed ? 'is-failed' : ''}`}
        open={activityStepDetailShouldOpen(step, { forceOpen: detailsOpen })}
      >
        <summary>
          {activityStepIcon(step)}
          <span>{title}</span>
        </summary>
        <div className="activity-shell">
          <div className="activity-shell-head">Shell</div>
          <pre><code>{shellText}</code></pre>
          <div className="activity-shell-status">{statusText}</div>
        </div>
      </details>
    );
  }

  return (
    <div className="activity-meta-line">
      <MarkdownContent
        className="message-content activity-markdown activity-meta-label"
        text={step.label}
      />
      <MarkdownContent
        className="message-content activity-markdown activity-meta-detail"
        text={detail}
      />
    </div>
  );
}

function SubagentActivityBlock({ item, detailsOpen = false }) {
  const items = item.items || [];
  const agents = items.flatMap((step) => (Array.isArray(step.subAgents) ? step.subAgents : []));
  const title = items[0]?.label || item.title || `${agents.length || 1} 个后台智能体（使用 @ 标记智能体）`;
  const running = items.some((step) => step.status === 'running' || step.status === 'queued');
  return (
    <details className="activity-meta activity-subagents" open={running || detailsOpen}>
      <summary className="activity-meta-summary">
        <Bot size={13} />
        <span>{title}</span>
      </summary>
      <div className="activity-subagent-list">
        {agents.length ? agents.map((agent) => (
          <div key={agent.threadId || `${agent.nickname}-${agent.role}`} className="activity-subagent-row">
            <span>
              <strong>{agent.nickname || agent.threadId || '子代理'}</strong>
              {agent.role ? <small>({agent.role})</small> : null}
              <em>{agent.statusText || '打开'}</em>
            </span>
          </div>
        )) : (
          <div className="activity-subagent-row">
            <span><strong>{item.title}</strong></span>
          </div>
        )}
      </div>
    </details>
  );
}

function activityMetaIcon(item) {
  if ((item.items || []).some((step) => isSkillActivityStep(step))) {
    return <BookOpenCheck size={13} strokeWidth={1.9} />;
  }
  if (item.metaType === 'command') {
    return <SquareTerminal size={13} strokeWidth={1.9} />;
  }
  if (item.metaType === 'edit') {
    return <Pencil size={13} />;
  }
  if (item.metaType === 'search' || item.metaType === 'web_search') {
    return <Search size={13} />;
  }
  if (item.metaType === 'subagent') {
    return <Bot size={13} />;
  }
  return <FileText size={13} />;
}

function activityStepIcon(step) {
  if (isSkillActivityStep(step)) {
    return <BookOpenCheck size={13} strokeWidth={1.9} />;
  }
  if (step.type === 'command') {
    return <SquareTerminal size={13} strokeWidth={1.9} />;
  }
  if (step.type === 'search' || step.type === 'web_search') {
    return <Search size={13} />;
  }
  return <FileText size={13} />;
}
