/**
 * 解析 Codex 消息中的 `<oai-mem-citation>` 块并格式化行号与 rollout id 展示。
 *
 * Keywords: memory citation, oai-mem-citation, rollout, parsing
 *
 * Exports:
 * - splitMemoryCitationBlock、formatCitationLines、shortRolloutId — 文本拆分与展示辅助。
 *
 * Inward: 无外部模块依赖。
 *
 * Outward: MarkdownContent.jsx
 */

export function splitMemoryCitationBlock(content) {
  const value = String(content || '');
  const blocks = [];
  const text = value.replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/g, (block) => {
    const citation = parseMemoryCitationBlock(block);
    if (citation) {
      blocks.push(citation);
    }
    return '';
  }).trim();

  if (!blocks.length) {
    return { text: value, citation: null };
  }

  return {
    text,
    citation: {
      entries: blocks.flatMap((block) => block.entries),
      rolloutIds: blocks.flatMap((block) => block.rolloutIds)
    }
  };
}

export function formatCitationLines(entry) {
  if (!entry?.lineStart) {
    return '';
  }
  if (entry.lineStart === entry.lineEnd) {
    return `${entry.lineStart} 行`;
  }
  return `${entry.lineStart}-${entry.lineEnd} 行`;
}

export function shortRolloutId(value) {
  const id = String(value || '').trim();
  return id.length > 8 ? id.slice(0, 8) : id;
}

function parseMemoryCitationBlock(block) {
  const entriesRaw = block.match(/<citation_entries>([\s\S]*?)<\/citation_entries>/)?.[1] || '';
  const rolloutsRaw = block.match(/<rollout_ids>([\s\S]*?)<\/rollout_ids>/)?.[1] || '';
  const entries = entriesRaw
    .split('\n')
    .map(parseMemoryCitationEntry)
    .filter(Boolean);
  const rolloutIds = rolloutsRaw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!entries.length && !rolloutIds.length) {
    return null;
  }
  return { entries, rolloutIds };
}

function parseMemoryCitationEntry(line) {
  const value = String(line || '').trim();
  if (!value) {
    return null;
  }
  const match = value.match(/^(.+):(\d+)-(\d+)\|note=\[(.*)\]$/);
  if (!match) {
    return {
      file: value,
      lineStart: null,
      lineEnd: null,
      note: ''
    };
  }
  return {
    file: match[1],
    lineStart: Number(match[2]),
    lineEnd: Number(match[3]),
    note: match[4]
  };
}
