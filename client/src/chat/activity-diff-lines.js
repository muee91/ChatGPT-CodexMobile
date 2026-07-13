/**
 * 活动文件卡片的 diff 文本解析器，兼容标准 unified diff 与 apply_patch 简化 hunk。
 *
 * Keywords: activity diff, unified diff, apply_patch
 *
 * Exports:
 * - parseUnifiedDiffLines — 把 diff 文本拆成 add/del/ctx/hunk/meta 行。
 *
 * Inward: 无外部依赖。
 *
 * Outward: ActivityFileSummary.jsx、activity-file-summary.test.mjs。
 */

export function parseUnifiedDiffLines(unifiedDiff = '') {
  const rows = [];
  let oldLine = null;
  let newLine = null;
  for (const rawLine of String(unifiedDiff || '').split(/\r?\n/)) {
    const hunk = rawLine.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      rows.push({ type: 'hunk', oldLine: '', newLine: '', text: rawLine });
      continue;
    }
    if (rawLine.startsWith('@@')) {
      oldLine = null;
      newLine = null;
      rows.push({ type: 'hunk', oldLine: '', newLine: '', marker: '', text: rawLine });
      continue;
    }
    if (/^(diff --git|index |--- |\+\+\+ )/.test(rawLine)) {
      continue;
    }
    if (rawLine.startsWith('\\ No newline')) {
      rows.push({ type: 'meta', oldLine: '', newLine: '', text: rawLine });
      continue;
    }
    if (rawLine.startsWith('+')) {
      rows.push({ type: 'add', oldLine: '', newLine: nextDiffLineNumber(newLine), marker: '+', text: rawLine.slice(1) });
      newLine = incrementDiffLineNumber(newLine);
    } else if (rawLine.startsWith('-')) {
      rows.push({ type: 'del', oldLine: nextDiffLineNumber(oldLine), newLine: '', marker: '-', text: rawLine.slice(1) });
      oldLine = incrementDiffLineNumber(oldLine);
    } else {
      rows.push({
        type: 'ctx',
        oldLine: nextDiffLineNumber(oldLine),
        newLine: nextDiffLineNumber(newLine),
        marker: ' ',
        text: rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine
      });
      oldLine = incrementDiffLineNumber(oldLine);
      newLine = incrementDiffLineNumber(newLine);
    }
  }
  return rows;
}

function nextDiffLineNumber(value) {
  return value === null ? '' : value;
}

function incrementDiffLineNumber(value) {
  return value === null ? null : value + 1;
}
