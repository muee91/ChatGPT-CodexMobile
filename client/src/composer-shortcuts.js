/**
 * Composer 斜杠指令表及 token 检测、替换与按查询过滤。
 *
 * Keywords: composer, slash-commands, autocomplete, tokens
 *
 * Exports:
 * - SLASH_COMMANDS — 内置指令与插入文案配置。
 * - detectComposerToken / replaceComposerToken / filteredSlashCommands / exactSlashCommandForInput — 编辑器辅助。
 *
 * Inward: 无。
 *
 * Outward: 输入框、快捷指令菜单。
 */

export const SLASH_COMMANDS = [
  {
    id: 'status',
    token: '/状态',
    aliases: ['/status'],
    title: '状态',
    description: '查看上下文、额度和连接状态',
    action: 'open-context'
  },
  {
    id: 'compact',
    token: '/压缩上下文',
    aliases: ['/compact'],
    title: '压缩上下文',
    description: '把旧上下文压缩成摘要，保持线程轻量',
    action: 'compact-context'
  },
  {
    id: 'review',
    token: '/代码审查',
    aliases: ['/review'],
    title: '代码审查',
    description: '检查当前改动的风险、bug 和遗漏测试',
    action: 'insert-prompt',
    prompt: '请以代码审查视角检查当前仓库改动，优先指出 bug、行为回归、风险和缺失测试，并给出具体文件位置。'
  },
  {
    id: 'subagents',
    token: '/子代理',
    aliases: ['/subagents'],
    title: '子代理',
    description: '提示 Codex 在适合时拆分并行任务',
    action: 'insert-prompt',
    prompt: '如果任务适合拆分，请使用子代理并行处理互不冲突的部分，然后汇总结果。'
  }
];

export function detectComposerToken(text, cursor = null) {
  const value = String(text || '');
  const end = Number.isInteger(cursor) ? Math.max(0, Math.min(cursor, value.length)) : value.length;
  const before = value.slice(0, end);
  const match = before.match(/(^|\s)([/@$])([^\s/@$]*)$/u);
  if (!match) {
    return null;
  }
  const marker = match[2];
  const query = match[3] || '';
  const markerIndex = end - marker.length - query.length;
  return {
    type: marker === '/' ? 'slash' : marker === '$' ? 'skill' : 'file',
    marker,
    query,
    start: markerIndex,
    end
  };
}

export function replaceComposerToken(text, token, replacement) {
  if (!token) {
    return String(text || '');
  }
  const value = String(text || '');
  const next = `${value.slice(0, token.start)}${replacement}${value.slice(token.end)}`;
  return next.replace(/[ \t]{2,}/g, ' ');
}

export function filteredSlashCommands(query, commands = SLASH_COMMANDS) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) {
    return commands;
  }
  return commands.filter((command) => {
    const tokens = [command.token, command.title, command.description, ...(command.aliases || [])]
      .filter(Boolean)
      .map((item) => String(item).toLowerCase());
    return tokens.some((item) => item.includes(normalized));
  });
}

export function exactSlashCommandForInput(text, commands = SLASH_COMMANDS) {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return commands.find((command) => {
    const values = [command.token, ...(command.aliases || [])]
      .filter(Boolean)
      .map((item) => String(item).trim().toLowerCase());
    return values.includes(normalized);
  }) || null;
}
