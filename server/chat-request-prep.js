/**
 * 将客户端请求体规整为 Codex 调用参数：技能列表、协作模式、项目外线程工作目录等。
 *
 * Keywords: chat-request, skills, collaboration-mode, projectless
 *
 * Exports:
 * - projectlessThreadWorkingDirectory — 解析无项目线程的工作目录。
 * - normalizeSelectedSkills — 规范化技能选择。
 * - normalizeCollaborationMode — 规范化协作模式。
 * - prepareChatRequest — 产出 send/request 载荷与元数据。
 *
 * Inward（本模块依赖/组装的关键符号）: codex-config、codex-data、upload-service、shared/service-tier。
 *
 * Outward（谁在用/调用场景）: chat-service、测试。
 *
 * 不负责: 实际跑 Codex 进程。
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  defaultProjectlessWorkspaceRoot
} from './codex-config.js';
import {
  normalizeFileMentions,
  normalizeAttachments,
  withFileMentionReferences,
  withAttachmentReferences,
  withImageAttachmentPreviews
} from './upload-service.js';
import { normalizeServiceTier } from '../shared/service-tier.js';

function dateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function slugFromMessage(message, fallback = 'mobile-chat') {
  const ascii = String(message || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(0, 48);
  return ascii || fallback;
}

export async function projectlessThreadWorkingDirectory(project, message, {
  date = new Date(),
  now = Date.now,
  mkdir = fs.mkdir,
  defaultWorkspaceRoot = defaultProjectlessWorkspaceRoot
} = {}) {
  const root = path.resolve(project?.path || defaultWorkspaceRoot());
  const day = dateStamp(date);
  const slug = slugFromMessage(message);
  const unique = `${slug}-${now().toString(36)}`;
  const cwd = path.join(root, day, unique);
  await mkdir(cwd, { recursive: true });
  return cwd;
}

export function normalizeSelectedSkills(value, availableSkills = []) {
  const requested = Array.isArray(value) ? value : [];
  if (!requested.length || !Array.isArray(availableSkills) || !availableSkills.length) {
    return [];
  }

  const byPath = new Map();
  const byName = new Map();
  for (const skill of availableSkills) {
    if (skill?.path) {
      byPath.set(String(skill.path), skill);
    }
    if (skill?.name) {
      byName.set(String(skill.name), skill);
    }
  }

  const selected = [];
  const seen = new Set();
  for (const item of requested) {
    const pathValue = typeof item === 'string' ? item : item?.path;
    const nameValue = typeof item === 'string' ? item : item?.name;
    const skill = byPath.get(String(pathValue || '')) || byName.get(String(nameValue || ''));
    if (!skill?.path || seen.has(skill.path)) {
      continue;
    }
    seen.add(skill.path);
    selected.push({
      type: 'skill',
      name: skill.name || skill.label || path.basename(path.dirname(skill.path)),
      path: skill.path
    });
  }
  return selected.slice(0, 8);
}

export function normalizeCollaborationMode(value, { model = '', reasoningEffort = null } = {}) {
  const requestedMode = typeof value === 'string' ? value : value?.mode;
  const mode = String(requestedMode || '').trim().toLowerCase();
  const settings = typeof value === 'object' && value?.settings ? value.settings : {};
  const normalizedSettings = {
    model: String(settings.model ?? model ?? '').trim(),
    reasoning_effort: settings.reasoning_effort ?? settings.reasoningEffort ?? reasoningEffort ?? null,
    developer_instructions: settings.developer_instructions ?? null
  };
  if (['default', 'normal', 'none', 'off'].includes(mode)) {
    return {
      mode: 'default',
      settings: normalizedSettings
    };
  }
  if (mode !== 'plan') {
    return null;
  }
  return {
    mode: 'plan',
    settings: normalizedSettings
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

export function prepareChatRequest(body = {}, {
  getSession = () => null,
  config = {},
  defaultReasoningEffort = 'xhigh',
  uploadRoot = '',
  createTurnId = crypto.randomUUID
} = {}) {
  const attachments = normalizeAttachments(body.attachments, {
    uploadRoot,
    strictUploadRoot: Boolean(uploadRoot)
  });
  const fileMentions = normalizeFileMentions(body.fileMentions);
  const message = String(body.message || '').trim();
  if (!message && !attachments.length) {
    throw badRequest('message or attachments are required');
  }

  const requestedSessionId = String(body.sessionId || '').trim();
  const isDraftSession = requestedSessionId.startsWith('draft-');
  const session = requestedSessionId && !isDraftSession ? getSession(requestedSessionId) : null;
  const requestedProjectId = String(body.projectId || '').trim();
  if (session?.projectId && requestedProjectId && session.projectId !== requestedProjectId) {
    throw conflict('Session does not belong to project');
  }
  const draftSessionId = String(body.draftSessionId || '').trim() || null;
  const selectedSessionId = session && !session.mobileOnly
    ? session.id
    : (requestedSessionId && !isDraftSession ? requestedSessionId : null);
  const turnId = String(body.clientTurnId || '').trim() || createTurnId();
  const sendMode = String(body.sendMode || body.mode || 'start').trim();
  const selectedSkills = normalizeSelectedSkills(body.selectedSkills, config.skills);
  const modelForTurn = session?.model || body.model || config.model || 'gpt-5.5';
  const reasoningEffortForTurn = body.reasoningEffort || defaultReasoningEffort;
  const serviceTierForTurn = normalizeServiceTier(body.serviceTier);
  const collaborationMode = normalizeCollaborationMode(body.collaborationMode, {
    model: modelForTurn,
    reasoningEffort: reasoningEffortForTurn
  });
  const visibleMessageOverride = String(body.visibleMessage || body.displayMessage || '').trim();
  const displayMessage = visibleMessageOverride || message || '请查看附件。';
  const visibleMessage = withImageAttachmentPreviews(displayMessage, attachments);
  const codexMessage = withFileMentionReferences(
    withAttachmentReferences(message || '请查看附件。', attachments),
    fileMentions
  );
  const conversationSessionId = selectedSessionId || draftSessionId || null;

  return {
    attachments,
    fileMentions,
    message,
    requestedSessionId,
    isDraftSession,
    session,
    draftSessionId,
    selectedSessionId,
    turnId,
    sendMode,
    selectedSkills,
    modelForTurn,
    reasoningEffortForTurn,
    serviceTierForTurn,
    collaborationMode,
    displayMessage,
    visibleMessage,
    codexMessage,
    conversationSessionId
  };
}
