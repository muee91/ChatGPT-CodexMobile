/**
 * 测试 chat/memory-citation.js：记忆引用块拆分与展示行格式化。
 * Keywords: memory-citation, tests
 * Exports: 无导出 / 内含用例
 * Inward: chat/memory-citation.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatCitationLines,
  shortRolloutId,
  splitMemoryCitationBlock
} from './chat/memory-citation.js';

test('splitMemoryCitationBlock removes raw citation xml from visible text', () => {
  const result = splitMemoryCitationBlock(`已推送。

<oai-mem-citation>
<citation_entries>
MEMORY.md:235-236|note=[used prior stuck running state lesson]
rollout_summaries/a.md:10-10|note=[used rollout context]
</citation_entries>
<rollout_ids>
019e04a2-46ed-7d82-97b7-cc7f6625873e
</rollout_ids>
</oai-mem-citation>`);

  assert.equal(result.text, '已推送。');
  assert.equal(result.citation.entries.length, 2);
  assert.deepEqual(result.citation.entries[0], {
    file: 'MEMORY.md',
    lineStart: 235,
    lineEnd: 236,
    note: 'used prior stuck running state lesson'
  });
  assert.deepEqual(result.citation.rolloutIds, ['019e04a2-46ed-7d82-97b7-cc7f6625873e']);
});

test('memory citation helpers format compact mobile labels', () => {
  assert.equal(formatCitationLines({ lineStart: 218, lineEnd: 218 }), '218 行');
  assert.equal(formatCitationLines({ lineStart: 235, lineEnd: 236 }), '235-236 行');
  assert.equal(shortRolloutId('019e04a2-46ed-7d82-97b7-cc7f6625873e'), '019e04a2');
});
