/**
 * 渲染上下文占用环形指示与弹层详情，供 Composer 展示 token 窗口与压缩状态。
 *
 * Keywords: context window, token usage, ring chart, popover
 *
 * Exports:
 * - ContextStatusDetails — 上下文百分比、剩余量与自动压缩说明。
 * - ContextStatusButton — 触发详情切换的按钮（含紧凑形态）；无 default。
 *
 * Inward: ../app/context-status.js（formatTokenCount、normalizeContextStatus 等）。
 *
 * Outward: Composer.jsx
 */

import { formatTokenCount, normalizeContextStatus, numberOrNull } from '../app/context-status.js';

const RING_SIZE = 22;
const RING_STROKE = 2.25;

function ContextCapacityRing({ percent }) {
  const size = RING_SIZE;
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - RING_STROKE) / 2 - 0.75;
  const circumference = 2 * Math.PI * r;
  const pct = percent == null ? null : Math.max(0, Math.min(100, Number(percent)));
  const offset =
    pct === null ? circumference : circumference * (1 - pct / 100);

  return (
    <svg
      className="context-capacity-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      focusable="false"
    >
      <circle
        className="context-capacity-ring-track"
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        strokeWidth={RING_STROKE}
      />
      {pct !== null ? (
        <circle
          className="context-capacity-ring-fill"
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      ) : null}
    </svg>
  );
}

export function ContextStatusDetails({ contextStatus }) {
  const context = normalizeContextStatus(contextStatus);
  const usedPercent = numberOrNull(context.percent);
  const remainingPercent = usedPercent === null ? null : Math.max(0, Math.round((100 - usedPercent) * 10) / 10);
  const inputTokens = context.inputTokens;
  const contextWindow = context.contextWindow;
  const compact = context.autoCompact || {};
  const compactText = compact.detected
    ? 'Codex 已自动压缩背景信息'
    : 'Codex 自动压缩其背景信息';

  return (
    <>
      <div className="context-popover-title">背景信息窗口：</div>
      <div>
        {usedPercent !== null && remainingPercent !== null
          ? `${usedPercent}% 已用（剩余 ${remainingPercent}%）`
          : '正在同步背景信息窗口'}
      </div>
      <div>
        已用 {formatTokenCount(inputTokens)} 标记，共 {formatTokenCount(contextWindow)}
      </div>
      <div>{compactText}</div>
    </>
  );
}

export function ContextStatusButton({ contextStatus, open, onToggle, variant = 'default' }) {
  const context = normalizeContextStatus(contextStatus);
  const usedPercent = numberOrNull(context.percent);
  const inputTokens = context.inputTokens;
  const contextWindow = context.contextWindow;
  const compact = context.autoCompact || {};
  const hasWindow = Boolean(inputTokens && contextWindow);
  const isCompact = variant === 'compact';

  if (isCompact) {
    const label =
      usedPercent !== null
        ? `上下文已用 ${Math.round(usedPercent)}%，查看详情`
        : '背景信息窗口，查看详情';
    const highUsage = usedPercent !== null && usedPercent >= 85;
    return (
      <button
        type="button"
        className={`context-status-compact ${compact.detected ? 'is-compacted' : ''} ${hasWindow ? 'has-window' : ''} ${highUsage ? 'is-high-usage' : ''}`}
        onClick={onToggle}
        aria-label={label}
        aria-expanded={open}
      >
        <ContextCapacityRing percent={usedPercent} />
      </button>
    );
  }

  return (
    <div className="context-status-wrap">
      <button
        type="button"
        className={`context-status-button ${compact.detected ? 'is-compacted' : ''} ${hasWindow ? 'has-window' : ''}`}
        onClick={onToggle}
        aria-label="查看背景信息窗口"
        aria-expanded={open}
      >
        <span className="context-status-dot" aria-hidden="true" />
        <span>{usedPercent !== null ? `${Math.round(usedPercent)}%` : '--'}</span>
      </button>
    </div>
  );
}
