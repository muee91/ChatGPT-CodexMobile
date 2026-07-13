/**
 * 用户消息的「语义身份」与图片签名：排除纯图片行后比对文本，并串联图片来源用于等价判断。
 *
 * Keywords: message-identity, userMessage, image-signature, dedupe, comparison
 *
 * Exports:
 * - userMessageImageSignature — 正文内图片链接的稳定串联签名。
 * - userMessageIdentity — 去掉图片行后的规范化文本。
 * - sameUserMessageContent — 文本与图片签名一致则视为同一条用户输入。
 *
 * Inward（本模块依赖/组装的关键符号）: 无。
 *
 * Outward（谁在用/调用场景）: client chat/message-identity 再导出、session-live-refresh、useAppWebSocket。
 */

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isMarkdownImageLine(line) {
  return /^!\[[^\]]*\]\((?:<[^>]*>|[^)]*?)\)\s*$/.test(String(line || '').trim());
}

function isLegacyImageAttachmentLine(line) {
  return /^[-*]\s*图片[:：]\s*.*?\s*\(.+\)\s*$/.test(String(line || '').trim());
}

function imageSourceFromLine(line) {
  const text = String(line || '').trim();
  const markdown = text.match(/^!\[[^\]]*\]\((?:<([^>]*)>|([^)]*?))\)\s*$/);
  if (markdown) {
    return normalizeWhitespace(markdown[1] || markdown[2]);
  }
  const legacy = text.match(/^[-*]\s*图片[:：]\s*.*?\s*\((.+)\)\s*$/);
  if (legacy) {
    return normalizeWhitespace(legacy[1]);
  }
  return '';
}

export function userMessageImageSignature(content) {
  return String(content || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(imageSourceFromLine)
    .filter(Boolean)
    .join('|');
}

export function userMessageIdentity(content) {
  const lines = String(content || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !isMarkdownImageLine(line) && !isLegacyImageAttachmentLine(line));
  return normalizeWhitespace(lines.join('\n').replace(/\n*附件路径[:：]\s*$/g, ''));
}

export function sameUserMessageContent(left, right) {
  const leftIdentity = userMessageIdentity(left);
  const rightIdentity = userMessageIdentity(right);
  if (!leftIdentity || !rightIdentity || leftIdentity !== rightIdentity) {
    return false;
  }
  const leftImages = userMessageImageSignature(left);
  const rightImages = userMessageImageSignature(right);
  return !leftImages || !rightImages || leftImages === rightImages;
}
