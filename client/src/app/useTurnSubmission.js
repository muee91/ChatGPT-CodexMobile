/**
 * 封装用户回合提交：校验选择、拼装请求、服务端优先的发送占位与错误/中断处理。
 *
 * Keywords: turn-submission, optimistic-user-message, composer-send
 *
 * Exports:
 * - `useTurnSubmission` — 绑定发送/队列所需状态与回调的 React hook。
 *
 * Inward: `api`；会话与活动合并逻辑（`session-utils`、`turn-submission-utils`、`activity-model`、`context-status`）。
 *
 * Outward: `App.jsx` 根组件注入 Composer 与聊天侧发送行为。
 */

import { apiFetch } from '../api.js';
import { serviceTierForModelSpeed } from '../composer/composer-options.js';
import {
  dismissPlanImplementationPrompts,
  upsertStatusMessage
} from '../chat/activity-model.js';
import {
  autoTitlePatch,
  createClientTurnId,
  createDraftSession,
  isDraftSession,
  titleFromFirstMessage
} from './session-utils.js';
import {
  displayMessageForTurn,
  completeLocalAbortMessages,
  implementationPromptForPlan,
  prepareComposerSubmission,
  projectForTurnSelection,
  restoredComposerText,
  sessionMatchesProject,
  sessionForTurnSelection,
  selectedSkillsForPaths
} from './turn-submission-utils.js';

export function useTurnSubmission({
  defaultReasoningEffort,
  selectedProject,
  selectedProjectRef,
  selectedSession,
  selectedSessionRef,
  projects,
  selectedSkillPaths,
  status,
  permissionMode,
  selectedModel,
  selectedModelSpeed,
  selectedReasoningEffort,
  input,
  attachments,
  fileMentions,
  runningById,
  runningByIdRef,
  setInput,
  setInputForDraftKey,
  setAttachments,
  setAttachmentsForDraftKey,
  setFileMentions,
  setFileMentionsForDraftKey,
  invalidateAttachmentWrites,
  setSelectedSession,
  setExpandedProjectIds,
  setSessionsByProject,
  setMessages,
  setSubmittingBySessionKey,
  upsertSessionInProject,
  markRun,
  clearRun,
  scheduleTurnRefresh,
  loadQueueDrafts
}) {
  function markSubmitting(sessionKey, value) {
    if (!sessionKey) {
      return;
    }
    setSubmittingBySessionKey((current) => {
      if (value) {
        return { ...current, [sessionKey]: true };
      }
      if (!current[sessionKey]) {
        return current;
      }
      const next = { ...current };
      delete next[sessionKey];
      return next;
    });
  }

  function restoreTextToInput(text) {
    setInput((current) => restoredComposerText(current, text));
  }

  async function submitCodexMessage({
    message,
    attachmentsForTurn = [],
    fileMentionsForTurn = [],
    clearComposer = false,
    restoreTextOnError = false,
    sendMode = 'start',
    collaborationMode = null,
    visibleMessageOverride = null,
    codexMessageOverride = null,
    planImplementation = null
  }) {
    if ((selectedSessionRef.current || selectedSession)?.archived) {
      throw new Error('Archived sessions are read-only');
    }
    const project = projectForTurnSelection(selectedProject, selectedProjectRef, selectedSession, selectedSessionRef, projects);
    const selectedAttachments = Array.isArray(attachmentsForTurn) ? attachmentsForTurn : [];
    const selectedFileMentions = Array.isArray(fileMentionsForTurn) ? fileMentionsForTurn : [];
    const displayMessage = displayMessageForTurn(visibleMessageOverride ?? message, selectedAttachments, selectedFileMentions);
    const requestMessage = String(codexMessageOverride || displayMessage || '').trim();
    if ((!displayMessage && !selectedAttachments.length && !selectedFileMentions.length) || !project) {
      if (restoreTextOnError && displayMessage) {
        restoreTextToInput(displayMessage);
      }
      throw new Error(project ? 'message or attachments are required' : '请先选择项目');
    }

    let sessionForTurn = sessionForTurnSelection(selectedSession, selectedSessionRef);
    if (sessionForTurn && !sessionMatchesProject(sessionForTurn, project.id)) {
      sessionForTurn = null;
      selectedSessionRef.current = null;
      setSelectedSession(null);
      setMessages([]);
    }
    if (!sessionForTurn) {
      sessionForTurn = createDraftSession(project);
      selectedSessionRef.current = sessionForTurn;
      setSelectedSession(sessionForTurn);
      setExpandedProjectIds((current) => ({ ...current, [project.id]: true }));
      setSessionsByProject((current) => upsertSessionInProject(current, project.id, sessionForTurn));
    }

    const turnId = createClientTurnId();
    const draftSessionId = isDraftSession(sessionForTurn) ? sessionForTurn.id : null;
    const outgoingSessionId = draftSessionId ? null : sessionForTurn?.id || null;
    const optimisticSessionId = draftSessionId || outgoingSessionId || turnId;
    const submittingSessionKey = outgoingSessionId || draftSessionId || optimisticSessionId;
    const initialTitle = draftSessionId && !sessionForTurn.titleLocked
      ? titleFromFirstMessage(displayMessage)
      : null;
    if (clearComposer) {
      setInputForDraftKey(submittingSessionKey, '');
      invalidateAttachmentWrites?.(submittingSessionKey);
      setAttachmentsForDraftKey(submittingSessionKey, []);
      setFileMentionsForDraftKey(submittingSessionKey, []);
    }
    markSubmitting(submittingSessionKey, true);

    const optimisticSessionPatch = { turnId, ...autoTitlePatch(initialTitle) };
    selectedSessionRef.current = { ...sessionForTurn, ...optimisticSessionPatch };
    setSelectedSession((current) =>
      current?.id === sessionForTurn?.id
        ? { ...current, ...optimisticSessionPatch }
        : current
    );
    setSessionsByProject((current) => ({
      ...current,
      [project.id]: (current[project.id] || []).map((item) =>
        item.id === sessionForTurn.id
          ? { ...item, ...optimisticSessionPatch }
          : item
      )
    }));
    const submittedAt = new Date().toISOString();
    setMessages((current) => upsertStatusMessage(current, {
      source: 'local-optimistic',
      projectId: project.id,
      sessionId: optimisticSessionId,
      previousSessionId: draftSessionId || outgoingSessionId,
      draftSessionId,
      turnId,
      kind: 'turn',
      status: 'queued',
      label: '消息发送中',
      detail: '',
      timestamp: submittedAt,
      startedAt: submittedAt,
      transient: true
    }));
    markRun?.({
      source: 'local-optimistic',
      projectId: project.id,
      sessionId: optimisticSessionId,
      previousSessionId: draftSessionId || outgoingSessionId,
      draftSessionId,
      turnId,
      status: 'queued',
      label: '消息发送中',
      startedAt: submittedAt,
      timestamp: submittedAt,
      steerable: false
    });

    try {
      const result = await apiFetch('/api/chat/send', {
        method: 'POST',
        body: {
          projectId: project.id,
          sessionId: outgoingSessionId,
          draftSessionId,
          clientTurnId: turnId,
          message: requestMessage,
          visibleMessage: displayMessage,
          permissionMode,
          model: selectedModel || status.model,
          serviceTier: serviceTierForModelSpeed(selectedModelSpeed),
          reasoningEffort: selectedReasoningEffort || status.reasoningEffort || defaultReasoningEffort,
          selectedSkills: selectedSkillsForPaths(status.skills, selectedSkillPaths),
          attachments: selectedAttachments,
          fileMentions: selectedFileMentions,
          sendMode,
          collaborationMode,
          ...(planImplementation ? { planImplementation } : {})
        }
      });
      const resultTurnId = result.turnId || turnId;
      markSubmitting(submittingSessionKey, false);
      if (result.sessionId && result.sessionId !== submittingSessionKey) {
        markSubmitting(result.sessionId, false);
      }
      const acceptedAt = new Date().toISOString();
      markRun?.({
        source: 'headless-local',
        projectId: project.id,
        sessionId: result.sessionId || optimisticSessionId,
        previousSessionId: draftSessionId || outgoingSessionId,
        draftSessionId,
        turnId: resultTurnId,
        clientTurnId: turnId,
        status: 'running',
        label: '执行中',
        startedAt: acceptedAt,
        timestamp: acceptedAt,
        steerable: true
      });
      if (result.sessionId) {
        scheduleTurnRefresh?.({
          source: 'headless-local',
          projectId: project.id,
          sessionId: result.sessionId,
          previousSessionId: draftSessionId || outgoingSessionId,
          draftSessionId,
          turnId: resultTurnId,
          clientTurnId: turnId,
          status: 'running',
          startedAt: acceptedAt,
          timestamp: acceptedAt
        });
      }
      return {
        turnId: resultTurnId,
        optimisticSessionId,
        projectId: project.id,
        previousSessionId: draftSessionId || outgoingSessionId
      };
    } catch (error) {
      markSubmitting(submittingSessionKey, false);
      clearRun({ turnId, sessionId: optimisticSessionId, previousSessionId: draftSessionId || outgoingSessionId });
      if (clearComposer) {
        invalidateAttachmentWrites?.(submittingSessionKey);
        setAttachmentsForDraftKey(submittingSessionKey, selectedAttachments);
        setFileMentionsForDraftKey(submittingSessionKey, selectedFileMentions);
        if (String(message || '').trim()) {
          setInputForDraftKey(submittingSessionKey, String(message).trim());
        }
      }
      if (restoreTextOnError) {
        restoreTextToInput(displayMessage);
      }
      setMessages((current) => upsertStatusMessage(current, {
        source: 'local-optimistic',
        projectId: project.id,
        sessionId: optimisticSessionId,
        previousSessionId: draftSessionId || outgoingSessionId,
        draftSessionId,
        turnId,
        kind: 'turn',
        status: 'failed',
        label: '发送失败',
        detail: error.message || '发送失败',
        timestamp: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        transient: false
      }));
      throw error;
    }
  }

  async function abortCurrentRun() {
    const currentSession = selectedSessionRef.current;
    const abortId =
      currentSession?.turnId ||
      currentSession?.id ||
      Object.keys(runningByIdRef.current || runningById)[0];
    if (!abortId) {
      return false;
    }
    const completedAt = new Date().toISOString();
    const abortPayload = {
      sessionId: currentSession?.id || abortId,
      turnId: currentSession?.turnId || null,
      previousSessionId: currentSession?.previousSessionId || null,
      completedAt,
      timestamp: completedAt
    };
    try {
      await apiFetch('/api/chat/abort', {
        method: 'POST',
        body: { sessionId: currentSession?.id || abortId, turnId: currentSession?.turnId || null }
      });
    } catch (error) {
      setMessages((current) =>
        upsertStatusMessage(current, {
          ...abortPayload,
          kind: 'turn',
          status: 'failed',
          label: '中止失败',
          detail: error.message || '桌面端没有确认中止，请在电脑端查看。',
          timestamp: new Date().toISOString()
        })
      );
      return false;
    }
    clearRun(abortPayload);
    setMessages((current) => completeLocalAbortMessages(current, abortPayload));
    return true;
  }

  async function handleSubmit({ mode = 'start', collaborationMode = null } = {}) {
    if ((selectedSessionRef.current || selectedSession)?.archived) {
      return false;
    }
    const prepared = prepareComposerSubmission(input, attachments, fileMentions, collaborationMode);
    const project = projectForTurnSelection(selectedProject, selectedProjectRef, selectedSession, selectedSessionRef, projects);
    if ((!prepared.message && !attachments.length && !fileMentions.length) || !project) {
      return false;
    }
    try {
      const result = await submitCodexMessage({
        message: prepared.message,
        attachmentsForTurn: attachments,
        fileMentionsForTurn: fileMentions,
        clearComposer: true,
        sendMode: mode === 'guide' ? 'interrupt' : mode,
        collaborationMode: prepared.collaborationMode
      });
      await loadQueueDrafts(selectedSessionRef.current);
      return result;
    } catch {
      // submitCodexMessage already reflects the failure in the chat UI.
      return false;
    }
  }

  async function handleAbort() {
    await abortCurrentRun();
  }

  async function handleImplementPlan(planImplementation) {
    const planContent = String(planImplementation?.planContent || '').trim();
    const prompt = implementationPromptForPlan(planContent);
    if (!prompt) {
      return false;
    }
    try {
      await submitCodexMessage({
        message: '执行计划',
        visibleMessageOverride: '执行计划',
        codexMessageOverride: prompt,
        clearComposer: false,
        sendMode: 'start',
        collaborationMode: 'default',
        planImplementation
      });
      const requestId = String(planImplementation?.requestId || '').trim();
      const requestTurnId = String(planImplementation?.turnId || '').trim();
      setMessages((current) =>
        dismissPlanImplementationPrompts(current, {
          ...planImplementation,
          requestId,
          turnId: requestTurnId
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  async function handleAdjustPlan(message, planImplementation = null) {
    const text = String(message || '').trim();
    if (!text) {
      return false;
    }
    try {
      await submitCodexMessage({
        message: text,
        clearComposer: false,
        sendMode: 'start',
        collaborationMode: null
      });
      if (planImplementation) {
        setMessages((current) => dismissPlanImplementationPrompts(current, planImplementation));
      }
      return true;
    } catch {
      return false;
    }
  }

  return {
    submitCodexMessage,
    handleSubmit,
    handleImplementPlan,
    handleAdjustPlan,
    handleAbort,
    abortCurrentRun
  };
}
