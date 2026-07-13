/**
 * 回合发送辅助纯函数：会话/项目选择、本地展示消息、Composer 提交体、技能路径、计划实施 prompt 与中止后本地消息补齐。
 *
 * Keywords: turn-submission, composer-payload, optimistic-user, abort-status
 *
 * Exports:
 * - 选择对齐 — `sessionForTurnSelection`、`projectForTurnSelection`。
 * - 消息与发送 — `displayMessageForTurn`、`prepareComposerSubmission`、`userMessageMetadataForSendMode`。
 * - 计划与技能 — `IMPLEMENT_PLAN_PROMPT_PREFIX`、`implementationPromptForPlan`、`selectedSkillsForPaths`、`restoredComposerText`。
 * - 中止 — `completeLocalAbortMessages`。
 *
 * Inward: `activity-model` 中活动/状态消息合并。
 *
 * Outward: `useTurnSubmission.js`。
 */

import {
  completeActivityMessagesForTurn,
  upsertStatusMessage
} from '../chat/activity-model.js';

export function sessionForTurnSelection(selectedSession, selectedSessionRef) {
  return selectedSessionRef?.current || selectedSession || null;
}

export function sessionMatchesProject(session, projectId) {
  const sessionProjectId = String(session?.projectId || '').trim();
  const targetProjectId = String(projectId || '').trim();
  if (!sessionProjectId || !targetProjectId) {
    return true;
  }
  return sessionProjectId === targetProjectId;
}

export function projectForTurnSelection(selectedProject, selectedProjectRef, selectedSession = null, selectedSessionRef = null, projects = []) {
  const session = selectedSessionRef?.current || selectedSession || null;
  const projectId = session?.projectId || null;
  if (!projectId) {
    return selectedProjectRef?.current || selectedProject || null;
  }
  const sessionProject = (Array.isArray(projects) ? projects : []).find((project) => project.id === projectId) || null;
  if (sessionProject) {
    return sessionProject;
  }
  return { id: projectId };
}

export function displayMessageForTurn(message, attachments = [], fileMentions = []) {
  const text = String(message || '').trim();
  if (text) {
    return text;
  }
  if (Array.isArray(attachments) && attachments.length) {
    return '请查看附件。';
  }
  if (Array.isArray(fileMentions) && fileMentions.length) {
    return '请查看引用文件。';
  }
  return '';
}

export function userMessageMetadataForSendMode(sendMode = 'start') {
  return sendMode === 'steer'
    ? {
      guided: true,
      guideLabel: '已引导对话',
      kind: 'guided_user'
    }
    : {};
}

export const IMPLEMENT_PLAN_PROMPT_PREFIX = 'PLEASE IMPLEMENT THIS PLAN:';

export function implementationPromptForPlan(planContent) {
  const text = String(planContent || '').trim();
  if (!text) {
    return '';
  }
  return 'Implement plan.';
}

export function prepareComposerSubmission(message, attachments = [], fileMentions = [], requestedCollaborationMode = null) {
  const raw = String(message || '').trim();
  const planMatch = raw.match(/^\/(?:plan|计划模式)(?:\s+|$)/iu);
  const messageText = planMatch ? raw.slice(planMatch[0].length).trim() : raw;
  const requestedMode = String(requestedCollaborationMode || '').trim().toLowerCase();
  return {
    message: displayMessageForTurn(messageText, attachments, fileMentions),
    collaborationMode: planMatch || requestedMode === 'plan' ? 'plan' : null
  };
}

export function selectedSkillsForPaths(skills, selectedSkillPaths) {
  const selected = new Set(selectedSkillPaths || []);
  return (Array.isArray(skills) ? skills : [])
    .filter((skill) => selected.has(skill.path))
    .map((skill) => ({
      name: skill.name || skill.label,
      path: skill.path
    }));
}

export function restoredComposerText(current, nextText) {
  const value = String(nextText || '').trim();
  if (!value) {
    return current;
  }
  const base = String(current || '').trimEnd();
  if (!base) {
    return value;
  }
  if (base.includes(value)) {
    return current;
  }
  return `${base}\n${value}`;
}

export function completeLocalAbortMessages(current, payload = {}) {
  const completedAt = payload.completedAt || payload.timestamp || new Date().toISOString();
  return upsertStatusMessage(
    completeActivityMessagesForTurn(current, { ...payload, completedAt }),
    {
      ...payload,
      kind: 'turn',
      status: 'completed',
      label: '已中止',
      completedAt,
      timestamp: completedAt
    }
  );
}
