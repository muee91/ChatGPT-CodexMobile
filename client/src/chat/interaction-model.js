/**
 * 将运行中审批/提问 sync event 转成聊天消息，并在用户处理后移除。
 *
 * Keywords: interaction, chat-message, approval, user-input, sync-event
 *
 * Exports:
 * - upsertInteractionRequestMessage — 插入或更新 pending 交互请求消息。
 * - resolveInteractionRequestMessage — 交互完成后从聊天流移除对应请求。
 *
 * Inward: sync event 中的 interaction payload。
 *
 * Outward: sync/useSyncSocket、ChatMessage。
 */

function clean(value) {
  const text = String(value || '').trim();
  return text;
}

function interactionMessageId(id) {
  return `interaction-${clean(id) || 'pending'}`;
}

function normalizedInteraction(event = {}) {
  const interaction = event.interaction || event;
  const id = clean(interaction.id || event.interactionId || event.id);
  return {
    ...interaction,
    id,
    kind: clean(interaction.kind || 'interaction'),
    title: clean(interaction.title || event.label || '需要你确认'),
    prompt: clean(interaction.prompt || event.detail || ''),
    status: clean(interaction.status || event.status || 'pending') || 'pending',
    questions: Array.isArray(interaction.questions) ? interaction.questions : [],
    sessionId: clean(interaction.sessionId || event.sessionId),
    turnId: clean(interaction.turnId || event.turnId || event.clientTurnId),
    createdAt: interaction.createdAt || event.timestamp || new Date().toISOString()
  };
}

export function upsertInteractionRequestMessage(current = [], event = {}) {
  const interaction = normalizedInteraction(event);
  if (!interaction.id) {
    return current;
  }
  const message = {
    id: interactionMessageId(interaction.id),
    role: 'interaction_request',
    content: interaction.title,
    status: interaction.status,
    timestamp: interaction.createdAt,
    sessionId: interaction.sessionId || null,
    turnId: interaction.turnId || null,
    interaction
  };
  const index = current.findIndex((item) => item.id === message.id);
  if (index < 0) {
    return [...current, message];
  }
  const next = [...current];
  next[index] = { ...next[index], ...message };
  return next;
}

export function resolveInteractionRequestMessage(current = [], event = {}) {
  const id = clean(event.interactionId || event.interaction?.id || event.id);
  if (!id) {
    return current;
  }
  const messageId = interactionMessageId(id);
  return current.filter((message) => message.id !== messageId);
}
