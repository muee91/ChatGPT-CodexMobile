/**
 * 测试 chat/activity-card-state.js：活动卡片是否在可见进程运行时应展开。
 * Keywords: activity-card, tests
 * Exports: 无导出 / 内含用例
 * Inward: chat/activity-card-state.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activityCardHeadline,
  activityCardShouldOpen,
  activityMessageIsRunning,
  effectiveActivityMessageIsRunning,
  initialActivityCardOpenState,
  nextActivityCardOpenState
} from './chat/activity-card-state.js';

test('activity card opens only while a visible process is running', () => {
  assert.equal(activityCardShouldOpen({ running: true, hasProcess: true }), true);
  assert.equal(activityCardShouldOpen({ running: false, hasProcess: true }), false);
  assert.equal(activityCardShouldOpen({ running: true, hasProcess: false }), false);
});

test('activity card folds process after completion even when edited files are summarized', () => {
  assert.equal(activityCardShouldOpen({ running: false, hasProcess: true, hasFileSummary: true }), false);
});

test('activity card treats running child steps as an active desktop process', () => {
  const message = {
    status: 'completed',
    activities: [
      { id: 'search', status: 'completed' },
      { id: 'command', status: 'running' }
    ]
  };

  assert.equal(activityMessageIsRunning(message), true);
  assert.equal(activityCardShouldOpen({ message, hasProcess: true }), true);
});

test('activity card can follow external runtime while desktop projection is stale completed', () => {
  const message = {
    status: 'completed',
    activities: [
      { id: 'command', status: 'completed' }
    ]
  };

  assert.equal(activityMessageIsRunning(message), false);
  assert.equal(effectiveActivityMessageIsRunning({ message, forceRunning: true }), true);
  assert.equal(activityCardShouldOpen({ running: true, hasProcess: true }), true);
});

test('activity card folds a forced-open process after runtime completion', () => {
  assert.equal(initialActivityCardOpenState({ running: true, hasProcess: true }), true);
  assert.equal(nextActivityCardOpenState({ previousOpen: true, running: false, hasProcess: true }), false);
  assert.equal(nextActivityCardOpenState({ previousOpen: false, running: false, hasProcess: true }), false);
});

test('activity card headline describes the active running step', () => {
  assert.equal(activityCardHeadline({
    message: { status: 'running' },
    activities: [
      { kind: 'command_execution', status: 'completed', label: '命令已完成' },
      { kind: 'file_change', status: 'running', label: '正在编辑文件' }
    ],
    running: true
  }), '正在编辑文件');
});

test('activity card headline keeps aborted distinct from normal completion', () => {
  assert.equal(activityCardHeadline({
    message: { status: 'completed', label: '已中止' },
    activities: [{ kind: 'command_execution', status: 'completed', label: '命令已完成' }],
    running: false
  }), '已中止');
});

test('activity card headline summarizes completed visible steps', () => {
  assert.equal(activityCardHeadline({
    message: { status: 'completed' },
    activities: [
      { kind: 'command_execution', status: 'completed', label: '命令已完成' },
      { kind: 'file_change', status: 'completed', label: '已编辑文件' }
    ],
    running: false
  }), '已完成 · 2 个步骤');
});

test('activity card headline surfaces command exit code on failure', () => {
  assert.equal(activityCardHeadline({
    message: { status: 'failed' },
    activities: [
      { kind: 'command_execution', status: 'failed', label: '命令失败', exitCode: 1 }
    ],
    running: false
  }), '失败 · 退出码 1');
});
