/**
 * 从用户/助手首条消息提炼会话标题：剥离 Markdown、口头禅与弱句，并截断长度。
 *
 * Keywords: session-title, provisionalSessionTitle, conversation, markdown-stripping, normalization
 *
 * Exports:
 * - provisionalSessionTitle — 单条消息的临时标题。
 * - sessionTitleFromConversation — 综合用户与助手消息择优标题。
 *
 * Inward（本模块依赖/组装的关键符号）: 无外部依赖，纯字符串处理。
 *
 * Outward（谁在用/调用场景）: client session-utils / useSessionActions；server session-title-generator、mobile-session-index、image-generator。
 */

const DEFAULT_TITLE = '新对话';
const MAX_TITLE_LENGTH = 22;

function normalizeTitleText(value) {
  return String(value || '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '图片')
    .replace(/```[\s\S]*?```/g, '代码')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[[^\]]+]\([^)]+\)/g, '')
    .replace(/[#>*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripInstructionWords(value) {
  return value
    .replace(/^(还有个问题|现在)?\s*(你先|你试试|试试|帮我|帮忙|麻烦|请|能不能|可不可以|可以帮我|给我|看看|看一下|看下|查一下|处理一下|调整一下)\s*/i, '')
    .replace(/^(可以\s*)?(按你说的|按刚才说的|就按这个|继续|好的|行|嗯)\s*/i, '')
    .replace(/^(这个|这块|这里|现在)\s*/i, '')
    .replace(/(可以吗|行吗|对吧|是不是|是什么|怎么调整|怎么改|帮我看看|看一下|看看|一下|吗|吧)[？?。.\s]*$/i, '')
    .trim();
}

function firstTitlePhrase(value) {
  const text = normalizeTitleText(value);
  const phrase = text.split(/[。！？!?；;\n\r]/)[0] || text;
  return stripInstructionWords(phrase)
    .replace(/[，,：:、]+$/g, '')
    .trim();
}

function compactTitle(value) {
  const text = stripInstructionWords(normalizeTitleText(value))
    .replace(/^(已调整|已完成|我已经|已经|完成了|处理完了)[:：，,\s]*/i, '')
    .replace(/^(移动端|前端|线程|会话|标题|命名|逻辑)(.*?)(改为|调整为|优化为).*/i, '$1$2')
    .replace(/(改为|调整为|优化为|已改成|已经改成).*/i, '')
    .replace(/(是什么|是怎么回事|怎么回事).*/i, '')
    .replace(/[，,。.!！?？：:；;].*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, MAX_TITLE_LENGTH).trim();
}

function weakTitle(value) {
  const text = normalizeTitleText(value);
  if (!text || text === DEFAULT_TITLE) {
    return true;
  }
  return /^(继续|好的|行|嗯|可以|按你说的|按刚才说的|就按这个|调整|处理|看看|看一下)$/i.test(text) || text.length < 4;
}

export function provisionalSessionTitle(message, fallback = DEFAULT_TITLE) {
  const title = compactTitle(firstTitlePhrase(message));
  return title && !weakTitle(title) ? title : fallback;
}

export function sessionTitleFromConversation({ userMessage, assistantMessage } = {}, fallback = DEFAULT_TITLE) {
  const userTitle = provisionalSessionTitle(userMessage, '');
  if (userTitle && !weakTitle(userTitle)) {
    return userTitle;
  }
  const assistantTitle = provisionalSessionTitle(assistantMessage, '');
  if (assistantTitle && !weakTitle(assistantTitle)) {
    return assistantTitle;
  }
  return userTitle || assistantTitle || fallback;
}
