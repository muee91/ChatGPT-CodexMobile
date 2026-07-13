/**
 * Context 窗口与 token 计量：格式化展示、把服务端多种字段名归一化为单一结构，并在轮询/WS 更新时深度合并。
 *
 * Keywords: context-window, token-count, merge-status
 *
 * Exports:
 * - `numberOrNull` / `formatTokenCount` — 数值清洗与缩写展示。
 * - `normalizeContextStatus` — 将任意 payload 规整为内部 context 形状（含 autoCompact）。
 * - `mergeContextStatus` — 合并增量更新与配置中的默认窗宽。
 *
 * Inward: 无 IO；纯数据变换。
 *
 * Outward: `App`、各 hooks、聊天与侧栏展示 context 用量。
 */

export function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function formatTokenCount(value) {
  const tokens = numberOrNull(value);
  if (!tokens) {
    return '--';
  }
  if (tokens >= 1000000) {
    return `${Math.round(tokens / 100000) / 10}m`;
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}k`;
  }
  return String(Math.round(tokens));
}

function timestampMs(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function preferCurrentValue(currentValue, incomingValue) {
  return incomingValue == null ? currentValue ?? null : incomingValue;
}

function sameAutoCompact(left = {}, right = {}) {
  return (
    Boolean(left.enabled) === Boolean(right.enabled) &&
    numberOrNull(left.tokenLimit) === numberOrNull(right.tokenLimit) &&
    Boolean(left.detected) === Boolean(right.detected) &&
    String(left.status || '') === String(right.status || '') &&
    String(left.lastCompactedAt || '') === String(right.lastCompactedAt || '') &&
    String(left.reason || '') === String(right.reason || '')
  );
}

export function contextStatusEquals(left = {}, right = {}) {
  const normalizedLeft = normalizeContextStatus(left);
  const normalizedRight = normalizeContextStatus(right);
  return (
    normalizedLeft.inputTokens === normalizedRight.inputTokens &&
    normalizedLeft.totalTokens === normalizedRight.totalTokens &&
    normalizedLeft.contextWindow === normalizedRight.contextWindow &&
    normalizedLeft.percent === normalizedRight.percent &&
    String(normalizedLeft.updatedAt || '') === String(normalizedRight.updatedAt || '') &&
    sameAutoCompact(normalizedLeft.autoCompact, normalizedRight.autoCompact)
  );
}

export function normalizeContextStatus(value = {}, fallback = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const inputTokens = numberOrNull(source.inputTokens ?? source.input_tokens ?? base.inputTokens);
  const totalTokens = numberOrNull(source.totalTokens ?? source.total_tokens ?? base.totalTokens);
  const contextWindow = numberOrNull(
    source.contextWindow ??
    source.modelContextWindow ??
    source.model_context_window ??
    base.contextWindow ??
    base.modelContextWindow
  );
  const percent =
    numberOrNull(source.percent ?? base.percent) ||
    (inputTokens && contextWindow ? Math.max(0, Math.min(100, Math.round((inputTokens / contextWindow) * 1000) / 10)) : null);
  const sourceCompact = source.autoCompact && typeof source.autoCompact === 'object' ? source.autoCompact : {};
  const baseCompact = base.autoCompact && typeof base.autoCompact === 'object' ? base.autoCompact : {};
  const tokenLimit = numberOrNull(
    sourceCompact.tokenLimit ??
    sourceCompact.token_limit ??
    source.autoCompactTokenLimit ??
    source.modelAutoCompactTokenLimit ??
    baseCompact.tokenLimit ??
    base.autoCompactTokenLimit
  );
  const detected = Boolean(sourceCompact.detected ?? baseCompact.detected);
  const compactEnabled = Boolean(sourceCompact.enabled ?? source.autoCompactEnabled ?? baseCompact.enabled ?? base.autoCompactEnabled ?? tokenLimit);
  return {
    ...base,
    ...source,
    inputTokens,
    totalTokens,
    contextWindow,
    percent,
    updatedAt: source.updatedAt || base.updatedAt || null,
    autoCompact: {
      ...baseCompact,
      ...sourceCompact,
      enabled: compactEnabled,
      tokenLimit,
      detected,
      status: sourceCompact.status || baseCompact.status || (detected ? 'detected' : compactEnabled ? 'watching' : 'unknown'),
      lastCompactedAt: sourceCompact.lastCompactedAt || baseCompact.lastCompactedAt || null,
      reason: sourceCompact.reason || baseCompact.reason || ''
    }
  };
}

export function mergeContextStatus(current, incoming, configContext = {}) {
  const config = normalizeContextStatus(configContext);
  const base = normalizeContextStatus(current || config, config);
  const next = normalizeContextStatus(incoming || {}, base);
  const incomingIsOlder =
    timestampMs(next.updatedAt) > 0 &&
    timestampMs(base.updatedAt) > 0 &&
    timestampMs(next.updatedAt) < timestampMs(base.updatedAt);
  if (incomingIsOlder) {
    return base;
  }
  const merged = {
    ...base,
    ...next,
    inputTokens: preferCurrentValue(base.inputTokens, next.inputTokens),
    totalTokens: preferCurrentValue(base.totalTokens, next.totalTokens),
    contextWindow: preferCurrentValue(base.contextWindow, next.contextWindow) || config.contextWindow || null,
    percent: preferCurrentValue(base.percent, next.percent),
    updatedAt: next.updatedAt || base.updatedAt || null,
    autoCompact: {
      ...base.autoCompact,
      ...next.autoCompact,
      tokenLimit: preferCurrentValue(base.autoCompact?.tokenLimit, next.autoCompact?.tokenLimit),
      detected: Boolean(next.autoCompact?.detected || base.autoCompact?.detected)
    }
  };
  return contextStatusEquals(base, merged) ? base : merged;
}
