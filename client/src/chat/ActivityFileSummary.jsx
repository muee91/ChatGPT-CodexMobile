/**
 * 活动变更文件列表与 unified diff 行级渲染，展示在活动卡片底部。
 *
 * Keywords: activity diff, file summary, unified diff
 *
 * Exports:
 * - ActivityFileSummary — 汇总 additions/deletions 与各文件可折叠 diff。
 *
 * Inward: activity-diff-lines。
 *
 * Outward: ChatPane.jsx
 */

import { parseUnifiedDiffLines } from './activity-diff-lines.js';

function ActivityDiffView({ diffs }) {
  const rows = (diffs || []).flatMap((diff, diffIndex) => {
    const parsed = parseUnifiedDiffLines(diff);
    if (diffIndex === 0) {
      return parsed;
    }
    return [{ type: 'gap', oldLine: '', newLine: '', text: '' }, ...parsed];
  });

  if (!rows.length) {
    return null;
  }
  return (
    <div className="activity-diff-shell">
      <div className="activity-diff-view">
        {rows.map((row, index) => (
          <div key={`${index}-${row.oldLine}-${row.newLine}`} className={`activity-diff-row is-${row.type}`}>
            <span className="activity-diff-num">{row.oldLine}</span>
            <span className="activity-diff-num">{row.newLine}</span>
            <span className="activity-diff-mark">{row.marker || ' '}</span>
            <code>{row.text || ' '}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ActivityFileSummary({ summary }) {
  return (
    <div className="activity-file-summary">
      <div className="activity-file-summary-head">
        <span>{summary.files.length} 个文件已更改</span>
        {summary.additions ? <strong className="is-added">+{summary.additions}</strong> : null}
        {summary.deletions ? <strong className="is-deleted">-{summary.deletions}</strong> : null}
      </div>
      <div className="activity-file-list">
        {summary.files.map((file) => (
          <details key={file.path} className="activity-file-item">
            <summary>
              <span>{file.label}</span>
              {file.additions ? <strong className="is-added">+{file.additions}</strong> : null}
              {file.deletions ? <strong className="is-deleted">-{file.deletions}</strong> : null}
            </summary>
            <ActivityDiffView diffs={file.diffs} />
          </details>
        ))}
      </div>
    </div>
  );
}
