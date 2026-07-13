/**
 * 测试 activity-timeline.js：工具类时间线占位项过滤。
 * Keywords: activity, timeline, tests
 * Exports: 无导出 / 内含用例
 * Inward: activity-timeline.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { isPlaceholderTimelineItem } from './activity-timeline.js';

test('isPlaceholderTimelineItem hides generic tool placeholders', () => {
  assert.equal(
    isPlaceholderTimelineItem({
      type: 'tool',
      label: '正在完成一步操作',
      detail: ''
    }),
    true
  );
});

test('isPlaceholderTimelineItem keeps concrete tool work', () => {
  assert.equal(
    isPlaceholderTimelineItem({
      type: 'tool',
      label: '正在完成一步操作',
      detail: '读取项目状态'
    }),
    false
  );
  assert.equal(
    isPlaceholderTimelineItem({
      type: 'search',
      label: '正在搜索',
      detail: ''
    }),
    false
  );
});
