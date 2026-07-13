/**
 * 聊天活动去重：规范化文案并在最终答案展示时移除重复的活动旁白。
 *
 * Keywords: activity, dedupe, final-answer, messages
 *
 * Exports:
 * - normalizeActivityText — 空白折叠与 trim。
 * - removeDuplicateFinalAnswerActivity — 按 turn/session 键匹配并清理活动步骤。
 *
 * Inward: 无；仅依赖消息对象结构约定。
 *
 * Outward: 会话消息归并、与活动相关的 reducer 管线。
 */

export function normalizeActivityText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function messageMatchesAnyRunKey(message, keys) {
  if (!keys.size) {
    return false;
  }
  return [message.turnId, message.sessionId, message.previousSessionId]
    .filter(Boolean)
    .some((key) => keys.has(String(key)));
}

export function removeDuplicateFinalAnswerActivity(messages, payload = {}) {
  const finalText = normalizeActivityText(payload.content || payload.label || '');
  if (!finalText) {
    return messages;
  }
  const keys = new Set([payload.turnId, payload.sessionId, payload.previousSessionId].filter(Boolean).map(String));
  if (!keys.size) {
    return messages;
  }

  return (messages || []).map((message) => {
    if (message?.role !== 'activity' || !Array.isArray(message.activities) || !messageMatchesAnyRunKey(message, keys)) {
      return message;
    }
    return {
      ...message,
      activities: message.activities.filter((activity) => {
        if (!['agent_message', 'message'].includes(activity?.kind)) {
          return true;
        }
        return normalizeActivityText(activity.label || activity.content || activity.detail) !== finalText;
      })
    };
  });
}
