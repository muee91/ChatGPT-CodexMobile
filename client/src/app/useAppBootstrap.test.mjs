/**
 * 测试 client/src/app/useAppBootstrap.js：侧栏同步时非当前项目会话预加载选择。
 * Keywords: bootstrap, sidebar, preload, tests
 * Exports: 无导出 / 内含用例
 * Inward: useAppBootstrap.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  currentSessionMatchesProject,
  projectsToPreloadForSidebar,
  shouldKeepCurrentSelectionOnLoad,
  shouldPreserveCurrentSelectionOnEmptyProject
} from './useAppBootstrap.js';

test('projectsToPreloadForSidebar skips current and empty projects, then sorts recent first', () => {
  const projects = [
    { id: 'current', sessionCount: 8, updatedAt: '2026-05-19T12:00:00.000Z' },
    { id: 'empty-recent', sessionCount: 0, updatedAt: '2026-05-19T14:00:00.000Z' },
    { id: 'lifeos', sessionCount: 9, updatedAt: '2026-05-19T14:15:44.000Z' },
    { id: 'codexmobile', sessionCount: 49, updatedAt: '2026-05-19T04:57:51.000Z' }
  ];

  assert.deepEqual(
    projectsToPreloadForSidebar(projects, 'current').map((project) => project.id),
    ['lifeos', 'codexmobile']
  );
});

test('shouldKeepCurrentSelectionOnLoad keeps the current session during preserved refresh when it is missing from the incoming list', () => {
  assert.equal(
    shouldKeepCurrentSelectionOnLoad({
      preserveSelection: true,
      currentSession: { id: 'thread-a', projectId: 'project-1' },
      projectId: 'project-1',
      sessions: [
        { id: 'thread-b', projectId: 'project-1' },
        { id: 'thread-c', projectId: 'project-1' }
      ]
    }),
    true
  );
});

test('currentSessionMatchesProject keeps preserved selection when the current session came from a snapshot without projectId', () => {
  assert.equal(
    currentSessionMatchesProject({ id: 'thread-a' }, 'project-1'),
    true
  );
  assert.equal(
    currentSessionMatchesProject({ id: 'thread-a', projectId: 'project-1' }, 'project-1'),
    true
  );
  assert.equal(
    currentSessionMatchesProject({ id: 'thread-a', projectId: 'project-2' }, 'project-1'),
    false
  );
});

test('shouldKeepCurrentSelectionOnLoad allows refresh to proceed when the current session is still present', () => {
  assert.equal(
    shouldKeepCurrentSelectionOnLoad({
      preserveSelection: true,
      currentSession: { id: 'thread-a', projectId: 'project-1' },
      projectId: 'project-1',
      sessions: [
        { id: 'thread-a', projectId: 'project-1' },
        { id: 'thread-b', projectId: 'project-1' }
      ]
    }),
    false
  );
});

test('shouldKeepCurrentSelectionOnLoad keeps the current session when a newer session appears in front', () => {
  assert.equal(
    shouldKeepCurrentSelectionOnLoad({
      preserveSelection: true,
      currentSession: { id: 'thread-a', projectId: 'project-1' },
      projectId: 'project-1',
      sessions: [
        { id: 'thread-b', projectId: 'project-1' },
        { id: 'thread-a', projectId: 'project-1' }
      ]
    }),
    false
  );
});

test('shouldPreserveCurrentSelectionOnEmptyProject keeps the current selection during preserved background refreshes', () => {
  assert.equal(
    shouldPreserveCurrentSelectionOnEmptyProject({
      preserveSelection: true,
      currentProject: { id: 'project-1' },
      currentSession: { id: 'thread-a', projectId: 'project-1' }
    }),
    true
  );
  assert.equal(
    shouldPreserveCurrentSelectionOnEmptyProject({
      preserveSelection: true,
      currentProject: { id: 'project-1' },
      currentSession: null
    }),
    true
  );
  assert.equal(
    shouldPreserveCurrentSelectionOnEmptyProject({
      preserveSelection: false,
      currentProject: { id: 'project-1' },
      currentSession: { id: 'thread-a', projectId: 'project-1' }
    }),
    false
  );
});
