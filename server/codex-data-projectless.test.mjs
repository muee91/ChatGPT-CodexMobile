/**
 * 测试 server/codex-data.js：移动端普通对话补齐 Codex projectless 登记。
 *
 * Keywords: codex-data, projectless, test
 *
 * Exports: 无导出，内含用例
 *
 * Inward: codex-data.js
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectlessMobileSessionRegistrations } from './codex-data.js';

test('projectlessMobileSessionRegistrations backfills mobile projectless threads missing from workspace state', () => {
  const registrations = projectlessMobileSessionRegistrations(
    new Map([
      ['mobile-thread-1', {
        id: 'mobile-thread-1',
        projectless: true,
        projectPath: '/tmp/codex-projectless/2026-05-14/mobile-chat-test'
      }],
      ['already-registered', {
        id: 'already-registered',
        projectless: true,
        projectPath: '/tmp/codex-projectless/2026-05-14/already'
      }],
      ['project-thread', {
        id: 'project-thread',
        projectless: false,
        projectPath: '/tmp/project'
      }]
    ]),
    {
      projectlessThreadIds: ['already-registered'],
      threadWorkspaceRootHints: {
        'already-registered': '/tmp/codex-projectless'
      }
    }
  );

  assert.deepEqual(registrations, [
    {
      id: 'mobile-thread-1',
      workspaceRoot: '/tmp/codex-projectless'
    }
  ]);
});
