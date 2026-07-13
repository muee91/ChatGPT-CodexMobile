/**
 * 活动步骤展示辅助：识别「思考中」类 reasoning 步骤及默认展示文案。
 *
 * Keywords: activity, reasoning, thinking, UI, steps
 *
 * Exports:
 * - isThinkingActivityStep — 是否为进行中的思考步骤。
 * - thinkingActivityText — 思考步骤展示用短文案。
 *
 * Inward: 无。
 *
 * Outward: activity-merge、聊天时间线渲染。
 */

export function isThinkingActivityStep(step = null) {
  const kind = String(step?.kind || '');
  const label = String(step?.label || step?.content || '').trim();
  if (kind !== 'reasoning') {
    return false;
  }
  const status = String(step?.status || '').toLowerCase();
  if (['completed', 'failed', 'cancelled', 'canceled'].includes(status)) {
    return false;
  }
  return /正在思考|思考中|thinking/i.test(label) || status === 'running' || status === 'queued';
}

export function thinkingActivityText(step = null) {
  const label = String(step?.label || step?.content || '').trim();
  return label || '正在思考';
}
