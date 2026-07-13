/**
 * 将 shared 的用户消息身份工具转发给客户端，用于内容去重与乐观 UI 对齐。
 *
 * Keywords: message-identity, re-export, dedupe
 *
 * Exports:
 * - sameUserMessageContent、userMessageIdentity、userMessageImageSignature — 来自 shared。
 *
 * Inward: ../../../shared/message-identity.js
 *
 * Outward: 会话合并、ChatMessage 相关逻辑。
 */

export {
  sameUserMessageContent,
  userMessageIdentity,
  userMessageImageSignature
} from '../../../shared/message-identity.js';
