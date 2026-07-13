/**
 * 测试 server/chat-request-prep.js：无项目工作目录与请求体规范化。
 *
 * Keywords: chat-request-prep, test, projectless
 *
 * Exports: 无导出，内含用例
 *
 * Inward: chat-request-prep.js
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  prepareChatRequest,
  projectlessThreadWorkingDirectory
} from './chat-request-prep.js';

test('prepareChatRequest normalizes skills, plan mode, attachments, and file mentions', () => {
  const prepared = prepareChatRequest({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-1',
    sendMode: 'queue',
    message: '看这里',
    attachments: [
      { id: 'img-1', name: '截图.png', path: '/tmp/screen shot.png', mimeType: 'image/png', kind: 'image' },
      { id: 'file-1', name: 'notes.md', path: '/tmp/notes.md', mimeType: 'text/markdown', kind: 'file' }
    ],
    fileMentions: [
      { name: 'App.jsx', path: '/repo/client/src/App.jsx' },
      { name: 'App duplicate', path: '/repo/client/src/App.jsx' },
      { name: 'server.js', path: '/repo/server/index.js' }
    ],
    selectedSkills: [
      { path: '/skills/frontend-design/SKILL.md' },
      { name: 'backend-helper' },
      { path: '/skills/frontend-design/SKILL.md' }
    ],
    collaborationMode: {
      mode: 'plan',
      settings: { developer_instructions: '只先规划' }
    },
    model: 'body-model',
    reasoningEffort: 'high',
    serviceTier: 'fast'
  }, {
    getSession: (sessionId) => ({ id: sessionId, mobileOnly: false, model: 'session-model' }),
    config: {
      model: 'config-model',
      skills: [
        { name: 'frontend-design', path: '/skills/frontend-design/SKILL.md' },
        { name: 'backend-helper', path: '/skills/backend-helper/SKILL.md' }
      ]
    },
    defaultReasoningEffort: 'xhigh'
  });

  assert.equal(prepared.session.id, 'thread-1');
  assert.equal(prepared.selectedSessionId, 'thread-1');
  assert.equal(prepared.draftSessionId, null);
  assert.equal(prepared.turnId, 'client-turn-1');
  assert.equal(prepared.sendMode, 'queue');
  assert.equal(prepared.modelForTurn, 'session-model');
  assert.equal(prepared.reasoningEffortForTurn, 'high');
  assert.equal(prepared.serviceTierForTurn, 'fast');
  assert.deepEqual(prepared.selectedSkills, [
    { type: 'skill', name: 'frontend-design', path: '/skills/frontend-design/SKILL.md' },
    { type: 'skill', name: 'backend-helper', path: '/skills/backend-helper/SKILL.md' }
  ]);
  assert.deepEqual(prepared.collaborationMode, {
    mode: 'plan',
    settings: {
      model: 'session-model',
      reasoning_effort: 'high',
      developer_instructions: '只先规划'
    }
  });
  assert.match(prepared.visibleMessage, /!\[截图\.png\]\(<\/tmp\/screen shot\.png>\)/);
  assert.match(prepared.codexMessage, /附件路径:/);
  assert.match(prepared.codexMessage, /截图\.png \(\/tmp\/screen shot\.png\)/);
  assert.match(prepared.codexMessage, /notes\.md \(\/tmp\/notes\.md\)/);
  assert.match(prepared.codexMessage, /引用文件路径:/);
  assert.match(prepared.codexMessage, /App\.jsx \(\/repo\/client\/src\/App\.jsx\)/);
  assert.doesNotMatch(prepared.codexMessage, /App duplicate/);
});

test('prepareChatRequest ignores unsupported service tier values', () => {
  const prepared = prepareChatRequest({
    message: 'hello',
    serviceTier: 'turbo'
  }, {
    getSession: () => null,
    config: {}
  });

  assert.equal(prepared.serviceTierForTurn, null);
});

test('prepareChatRequest normalizes default collaboration mode with runtime settings', () => {
  const prepared = prepareChatRequest({
    message: 'Implement plan.',
    collaborationMode: 'default',
    model: 'gpt-5.5',
    reasoningEffort: 'high'
  }, {
    getSession: () => null,
    config: {}
  });

  assert.deepEqual(prepared.collaborationMode, {
    mode: 'default',
    settings: {
      model: 'gpt-5.5',
      reasoning_effort: 'high',
      developer_instructions: null
    }
  });
});

test('prepareChatRequest keeps drafts separate and preserves mobile-only requested session ids', () => {
  const draft = prepareChatRequest({
    draftSessionId: 'draft-project-1-1',
    message: '新开一个'
  }, {
    getSession: () => null,
    config: { model: 'config-model', skills: [] },
    createTurnId: () => 'generated-turn-1'
  });

  assert.equal(draft.selectedSessionId, null);
  assert.equal(draft.draftSessionId, 'draft-project-1-1');
  assert.equal(draft.conversationSessionId, 'draft-project-1-1');
  assert.equal(draft.turnId, 'generated-turn-1');

  const mobileOnly = prepareChatRequest({
    sessionId: 'thread-mobile-only',
    message: '继续'
  }, {
    getSession: () => ({ id: 'thread-mobile-only', mobileOnly: true }),
    config: { model: 'config-model', skills: [] },
    createTurnId: () => 'generated-turn-2'
  });

  assert.equal(mobileOnly.selectedSessionId, 'thread-mobile-only');
  assert.equal(mobileOnly.conversationSessionId, 'thread-mobile-only');
  assert.equal(mobileOnly.turnId, 'generated-turn-2');
});

test('prepareChatRequest rejects sessions that belong to another project', () => {
  assert.throws(
    () => prepareChatRequest({
      projectId: 'project-1',
      sessionId: 'thread-2',
      message: '继续'
    }, {
      getSession: () => ({ id: 'thread-2', projectId: 'project-2', mobileOnly: false }),
      config: {}
    }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /Session does not belong to project/);
      return true;
    }
  );
});

test('prepareChatRequest can send an internal prompt while showing a short visible message', () => {
  const prepared = prepareChatRequest({
    projectId: 'project-1',
    sessionId: 'thread-1',
    message: 'PLEASE IMPLEMENT THIS PLAN:\n1. 修复同步',
    visibleMessage: '执行计划'
  }, {
    getSession: () => ({ id: 'thread-1' }),
    config: {}
  });

  assert.equal(prepared.displayMessage, '执行计划');
  assert.equal(prepared.visibleMessage, '执行计划');
  assert.equal(prepared.codexMessage, 'PLEASE IMPLEMENT THIS PLAN:\n1. 修复同步');
});

test('prepareChatRequest rejects empty text without attachments', () => {
  assert.throws(
    () => prepareChatRequest({ message: '   ' }, { getSession: () => null, config: {} }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /message or attachments/);
      return true;
    }
  );
});

test('projectlessThreadWorkingDirectory creates dated slug directories', async () => {
  const mkdirCalls = [];
  const cwd = await projectlessThreadWorkingDirectory(
    { path: '/tmp/codex-projectless' },
    'Hello world!',
    {
      date: new Date('2026-05-08T03:04:05.000Z'),
      now: () => 123456789,
      mkdir: async (dir, options) => mkdirCalls.push({ dir, options })
    }
  );

  assert.equal(cwd, path.join('/tmp/codex-projectless', '2026-05-08', 'hello-world-21i3v9'));
  assert.deepEqual(mkdirCalls, [{ dir: cwd, options: { recursive: true } }]);
});
