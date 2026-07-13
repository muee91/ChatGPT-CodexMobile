/**
 * 测试 app/turn-submission-utils.js：发步元数据、会话选择与轮询条件等工具。
 * Keywords: turn-submission, composer, tests
 * Exports: 无导出 / 内含用例
 * Inward: app/turn-submission-utils.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  displayMessageForTurn,
  completeLocalAbortMessages,
  implementationPromptForPlan,
  prepareComposerSubmission,
  projectForTurnSelection,
  restoredComposerText,
  sessionMatchesProject,
  sessionForTurnSelection,
  selectedSkillsForPaths,
  userMessageMetadataForSendMode
} from './app/turn-submission-utils.js';

test('sessionForTurnSelection prefers the synchronous selection ref', () => {
  const staleSession = { id: 'thread-before-render' };
  const draftSession = { id: 'draft-project-1', draft: true };

  assert.equal(sessionForTurnSelection(staleSession, { current: draftSession }), draftSession);
  assert.equal(sessionForTurnSelection(staleSession, { current: null }), staleSession);
});

test('sessionMatchesProject rejects a stale session from another project', () => {
  assert.equal(sessionMatchesProject({ id: 'thread-1', projectId: 'project-a' }, 'project-a'), true);
  assert.equal(sessionMatchesProject({ id: 'thread-1', projectId: 'project-a' }, 'project-b'), false);
  assert.equal(sessionMatchesProject({ id: 'thread-1' }, 'project-b'), true);
});

test('projectForTurnSelection prefers the synchronous project ref when no session project is fixed', () => {
  const staleProject = { id: 'project-before-render' };
  const currentProject = { id: 'project-current' };

  assert.equal(projectForTurnSelection(staleProject, { current: currentProject }), currentProject);
  assert.equal(projectForTurnSelection(staleProject, { current: null }), staleProject);
});

test('projectForTurnSelection falls back to the selected draft project id', () => {
  const project = { id: 'project-from-draft', name: 'CodexMobile' };
  const draftSession = { id: 'draft-project-from-draft-1', projectId: project.id, draft: true };

  assert.equal(projectForTurnSelection(null, { current: null }, null, { current: draftSession }, [project]), project);
});

test('projectForTurnSelection follows the existing session project before the current UI selection', () => {
  const sessionProject = { id: 'project-session', name: 'Session Project' };
  const selectedProject = { id: 'project-ui', name: 'Sidebar Project' };
  const existingSession = { id: 'thread-1', projectId: sessionProject.id };

  assert.deepEqual(
    projectForTurnSelection(selectedProject, { current: selectedProject }, existingSession, { current: existingSession }, [sessionProject, selectedProject]),
    sessionProject
  );
});

test('projectForTurnSelection keeps the session project id even when the project list is stale', () => {
  const selectedProject = { id: 'project-ui', name: 'Sidebar Project' };
  const existingSession = { id: 'thread-1', projectId: 'project-session' };

  assert.deepEqual(
    projectForTurnSelection(selectedProject, { current: selectedProject }, existingSession, { current: existingSession }, []),
    { id: 'project-session' }
  );
});

test('displayMessageForTurn provides attachment and file mention fallbacks', () => {
  assert.equal(displayMessageForTurn('  hello  ', [], []), 'hello');
  assert.equal(displayMessageForTurn('', [{ path: '/tmp/a.png' }], []), '请查看附件。');
  assert.equal(displayMessageForTurn('', [], [{ path: '/tmp/a.js' }]), '请查看引用文件。');
  assert.equal(displayMessageForTurn('', [], []), '');
});

test('prepareComposerSubmission strips leading plan command and marks collaboration mode', () => {
  assert.deepEqual(prepareComposerSubmission('/plan 先给我方案', [], []), {
    message: '先给我方案',
    collaborationMode: 'plan'
  });
  assert.deepEqual(prepareComposerSubmission('/计划模式', [], [{ path: '/tmp/a.js' }]), {
    message: '请查看引用文件。',
    collaborationMode: 'plan'
  });
});

test('prepareComposerSubmission can mark plan mode from the plus menu without slash text', () => {
  assert.deepEqual(prepareComposerSubmission('先给我方案', [], [], 'plan'), {
    message: '先给我方案',
    collaborationMode: 'plan'
  });
});

test('userMessageMetadataForSendMode marks steer messages as guided followups', () => {
  assert.deepEqual(userMessageMetadataForSendMode('start'), {});
  assert.deepEqual(userMessageMetadataForSendMode('steer'), {
    guided: true,
    guideLabel: '已引导对话',
    kind: 'guided_user'
  });
});

test('implementationPromptForPlan builds the minimal plan implementation prompt', () => {
  assert.equal(
    implementationPromptForPlan('  1. 定位同步链路\n2. 补测试  '),
    'Implement plan.'
  );
  assert.equal(implementationPromptForPlan('  '), '');
});

test('selectedSkillsForPaths returns structured skills without leaking tokens', () => {
  const selected = selectedSkillsForPaths(
    [
      { name: 'frontend-design', path: '/skills/frontend-design' },
      { label: 'unused', path: '/skills/unused' }
    ],
    ['/skills/frontend-design']
  );
  assert.deepEqual(selected, [{ name: 'frontend-design', path: '/skills/frontend-design' }]);
});

test('restoredComposerText appends failed message text only once', () => {
  assert.equal(restoredComposerText('', '继续修复'), '继续修复');
  assert.equal(restoredComposerText('先看日志', '继续修复'), '先看日志\n继续修复');
  assert.equal(restoredComposerText('先看日志\n继续修复', '继续修复'), '先看日志\n继续修复');
});

test('completeLocalAbortMessages finishes the optimistic running activity', () => {
  const messages = [
    {
      id: 'status-turn-1',
      role: 'activity',
      status: 'running',
      sessionId: 'thread-1',
      turnId: 'turn-1',
      content: '正在处理',
      label: '正在处理',
      timestamp: '2026-05-08T02:00:00.000Z',
      activities: [
        { id: 'thinking', kind: 'reasoning', label: '正在思考中', status: 'running' }
      ]
    }
  ];

  const next = completeLocalAbortMessages(messages, {
    sessionId: 'thread-1',
    turnId: 'turn-1',
    completedAt: '2026-05-08T02:00:05.000Z'
  });

  assert.equal(next[0].status, 'completed');
  assert.equal(next[0].label, '已中止');
  assert.equal(next[0].activities[0].status, 'completed');
  assert.equal(next[0].completedAt, '2026-05-08T02:00:05.000Z');
});
