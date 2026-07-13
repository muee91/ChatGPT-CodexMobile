/**
 * Codex 原生生图路径的 Markdown 与 turn input 拼装，及 legacy/direct 模式开关。
 *
 * Keywords: codex-images, markdown, skill-input, legacy-mode
 *
 * Exports:
 * - useLegacyImageGenerator — 环境变量决定走 legacy 路由与否。
 * - buildCodexTurnInput — 将消息/技能等拼成 Codex input 列表。
 * - imageMarkdownFromCodexImageGeneration — rollout 项转图片 Markdown。
 *
 * Inward（本模块依赖/组装的关键符号）: 无外部模块；仅 Node 内置与字面量工具函数。
 *
 * Outward（谁在用/调用场景）: chat-delivery、native image 测试、runner 相关逻辑。
 *
 * 不负责: 实际图片生成 API（由 Codex/CLI 执行）。
 */
function markdownImageDestination(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (/[\s<>()]/.test(raw)) {
    return `<${raw.replace(/>/g, '%3E')}>`;
  }
  return raw;
}

export function useLegacyImageGenerator(env = process.env) {
  const mode = String(env.CODEXMOBILE_IMAGE_ROUTE || env.CODEXMOBILE_IMAGE_MODE || '').trim().toLowerCase();
  return mode === 'legacy' || mode === 'direct';
}

export function buildCodexTurnInput({ message, larkInstruction = '', attachments = [], selectedSkills = [] } = {}) {
  const text = [message, larkInstruction].filter(Boolean).join('\n\n');
  const input = [];
  for (const skill of Array.isArray(selectedSkills) ? selectedSkills : []) {
    if (!skill?.path) {
      continue;
    }
    input.push({
      type: 'skill',
      name: skill.name || '',
      path: skill.path
    });
  }

  if (text) {
    input.push({ type: 'text', text, text_elements: [] });
  }

  for (const attachment of Array.isArray(attachments) ? attachments : []) {
    if (attachment?.kind === 'image' && attachment.path) {
      input.push({ type: 'localImage', path: attachment.path });
    }
  }

  return input.length ? input : [{ type: 'text', text: '', text_elements: [] }];
}

export function imageMarkdownFromCodexImageGeneration(item, alt = '生成图片') {
  const source = String(item?.savedPath || item?.result || '').trim();
  if (!source) {
    return '';
  }
  if (!/^data:image\//i.test(source) && !/^https?:\/\//i.test(source) && !source.startsWith('/')) {
    return '';
  }
  return `![${alt}](${markdownImageDestination(source)})`;
}
