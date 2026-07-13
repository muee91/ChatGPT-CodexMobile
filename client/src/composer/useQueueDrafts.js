/**
 * 管理会话队列草稿：拉取、删除、恢复与 steer，并同步输入/附件/技能状态。
 *
 * Keywords: queue drafts, chat queue, session, apiFetch
 *
 * Exports:
 * - useQueueDrafts — 返回 queueDrafts 与 load/remove/restore/steer 方法。
 *
 * Inward: ../api.js、../app/session-utils.js（draft vs 正式 session）。
 *
 * Outward: App.jsx / 持有 Composer 状态的容器。
 */

import { useCallback, useState } from 'react';
import { apiFetch } from '../api.js';
import { isDraftSession } from '../app/session-utils.js';

function queueQueryForSession(session) {
  if (!session?.id) {
    return '';
  }
  if (isDraftSession(session)) {
    return `draftSessionId=${encodeURIComponent(session.id)}`;
  }
  return `sessionId=${encodeURIComponent(session.id)}`;
}

function queueBodyForSession(session) {
  return {
    sessionId: isDraftSession(session) ? null : session?.id,
    draftSessionId: isDraftSession(session) ? session?.id : null
  };
}

export function useQueueDrafts({
  selectedSessionRef,
  selectedProjectRef,
  selectedProject,
  setInput,
  setAttachments,
  setFileMentions,
  setSelectedSkillPaths,
  setSelectedCollaborationMode,
  invalidateAttachmentWrites
}) {
  const [queueDrafts, setQueueDrafts] = useState([]);

  const loadQueueDrafts = useCallback(async (session = selectedSessionRef.current) => {
    const query = queueQueryForSession(session);
    if (!query) {
      setQueueDrafts([]);
      return;
    }
    try {
      const result = await apiFetch(`/api/chat/queue?${query}`);
      setQueueDrafts(Array.isArray(result.drafts) ? result.drafts : []);
    } catch {
      setQueueDrafts([]);
    }
  }, [selectedSessionRef]);

  const removeQueueDraft = useCallback(async (draftId) => {
    const session = selectedSessionRef.current;
    await apiFetch('/api/chat/queue', {
      method: 'DELETE',
      body: { ...queueBodyForSession(session), draftId }
    }).catch(() => null);
    await loadQueueDrafts(session);
  }, [loadQueueDrafts, selectedSessionRef]);

  const restoreQueueDraft = useCallback(async (draftId) => {
    const session = selectedSessionRef.current;
    const result = await apiFetch('/api/chat/queue/restore', {
      method: 'POST',
      body: { ...queueBodyForSession(session), draftId }
    }).catch(() => null);
    const draft = result?.draft;
    if (!draft) {
      await loadQueueDrafts(session);
      return;
    }
    invalidateAttachmentWrites?.();
    setSelectedCollaborationMode(draft.collaborationMode === 'plan' ? 'plan' : null);
    setInput(draft.text || '');
    setAttachments(Array.isArray(draft.attachments) ? draft.attachments : []);
    setFileMentions(Array.isArray(draft.fileMentions) ? draft.fileMentions : []);
    setSelectedSkillPaths((Array.isArray(draft.selectedSkills) ? draft.selectedSkills : [])
      .map((skill) => skill.path)
      .filter(Boolean));
    await loadQueueDrafts(session);
  }, [invalidateAttachmentWrites, loadQueueDrafts, selectedSessionRef, setAttachments, setFileMentions, setInput, setSelectedCollaborationMode, setSelectedSkillPaths]);

  const steerQueueDraft = useCallback(async (draftId) => {
    const session = selectedSessionRef.current;
    await apiFetch('/api/chat/queue/steer', {
      method: 'POST',
      body: {
        projectId: selectedProjectRef.current?.id || selectedProject?.id,
        ...queueBodyForSession(session),
        draftId
      }
    }).catch(() => null);
    await loadQueueDrafts(session);
  }, [loadQueueDrafts, selectedProject, selectedProjectRef, selectedSessionRef]);

  return {
    queueDrafts,
    loadQueueDrafts,
    removeQueueDraft,
    restoreQueueDraft,
    steerQueueDraft
  };
}
