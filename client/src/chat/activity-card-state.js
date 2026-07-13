/**
 * 根据运行态、文件变更与可展示进度，决定活动卡片是否默认展开。
 *
 * Keywords: activity card, expand, running
 *
 * Exports:
 * - activityCardShouldOpen — 返回是否应打开活动摘要。
 * - activityMessageIsRunning — 聚合容器与子步骤状态判断是否运行中。
 * - effectiveActivityMessageIsRunning — 合并外部 runtime 强制运行态后的最终判断。
 * - activityCardHeadline — 根据主状态与子步骤生成活动卡片摘要文案。
 * - initialActivityCardOpenState / nextActivityCardOpenState — 初始展开与状态变更后的保留展开策略。
 *
 * Inward: 无外部 import。
 *
 * Outward: ActivityMessage.jsx
 */

function statusIsRunning(status) {
  return status === 'running' || status === 'queued';
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function conciseText(value, maxLength = 16) {
  const text = compactText(value);
  if (!text) {
    return '';
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function activityKind(step = {}) {
  return String(step.kind || step.type || '').trim();
}

function activityLooksAborted(message = {}) {
  const source = `${message.status || ''} ${message.label || ''} ${message.content || ''}`.trim();
  return /aborted|cancelled|canceled|已中止|已取消|中止/.test(source);
}

function runningStepHeadline(step = {}) {
  const kind = activityKind(step);
  const label = compactText(step.label);
  if (String(step.status || '') === 'queued') {
    return '排队中';
  }
  if (kind === 'reasoning') {
    return label || '正在思考';
  }
  if (kind === 'context_compaction') {
    return label || '正在压缩上下文';
  }
  if (kind === 'file_change' || kind === 'edit' || (Array.isArray(step.fileChanges) && step.fileChanges.length)) {
    return '正在编辑文件';
  }
  if (kind === 'command_execution' || kind === 'command' || step.command) {
    return '正在运行命令';
  }
  if (kind === 'web_search') {
    return '正在搜索网页';
  }
  if (kind === 'search') {
    return '正在搜索';
  }
  if (kind === 'subagent_activity' || kind === 'subagent') {
    return '正在运行后台智能体';
  }
  if (kind === 'plan') {
    return '正在更新计划';
  }
  if (/^正在/.test(label)) {
    return conciseText(label);
  }
  return label ? `正在${conciseText(label.replace(/^已/, ''))}` : '执行中';
}

function failedHeadline(activities = []) {
  const failed = activities.find((activity) => String(activity?.status || '') === 'failed') || {};
  if (failed.exitCode !== undefined && failed.exitCode !== null) {
    return `失败 · 退出码 ${failed.exitCode}`;
  }
  const label = conciseText(failed.label || failed.error || failed.detail, 14);
  return label ? `失败 · ${label}` : '执行失败';
}

function completedHeadline(activities = []) {
  const count = activities.length;
  return count ? `已完成 · ${count} 个步骤` : '已完成';
}

export function activityMessageIsRunning(message = {}, activities = message.activities || []) {
  if (statusIsRunning(message.status)) {
    return true;
  }
  return (activities || []).some((activity) => statusIsRunning(activity?.status));
}

export function effectiveActivityMessageIsRunning({ message = {}, activities = message.activities || [], forceRunning = false } = {}) {
  return Boolean(forceRunning || activityMessageIsRunning(message, activities));
}

export function activityCardShouldOpen({ running, hasProcess, message, activities } = {}) {
  const active = running ?? activityMessageIsRunning(message, activities);
  return Boolean(hasProcess && active);
}

export function activityCardHeadline({ message = {}, activities = message.activities || [], running = false } = {}) {
  if (activityLooksAborted(message)) {
    return '已中止';
  }
  if (message.status === 'failed') {
    return failedHeadline(activities);
  }
  if (running) {
    const activeStep = [...(activities || [])].reverse().find((activity) => statusIsRunning(activity?.status));
    return runningStepHeadline(activeStep);
  }
  return completedHeadline(activities || []);
}

export function initialActivityCardOpenState({ running, hasProcess, forceOpen = false } = {}) {
  void running;
  return Boolean(hasProcess && forceOpen);
}

export function nextActivityCardOpenState({ previousOpen = false, running, hasProcess, forceOpen = false } = {}) {
  if (previousOpen && hasProcess && !running) {
    return true;
  }
  if (!hasProcess) {
    return false;
  }
  if (forceOpen) {
    return true;
  }
  return false;
}
