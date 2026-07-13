/**
 * 会话 CRUD 与导航：新建/删除/重命名、加载消息、切换项目、草稿转正与标题补丁等，集中封装为回调集合。
 *
 * Keywords: session-actions, draft-session, session-title, api-mutations
 *
 * Exports:
 * - `useSessionActions` — 返回会话相关 `handle*` 的 hook。
 *
 * Inward: `api`；`session-utils`、`context-status`、`interaction-model`、`shared/session-title`。
 *
 * Outward: `App.jsx` 注入侧栏与聊天操作。
 */

import { apiFetch } from '../api.js';
import { upsertInteractionRequestMessage } from '../chat/interaction-model.js';
import { sessionTitleFromConversation } from '../../../shared/session-title.js';
import { normalizeContextStatus } from './context-status.js';
import {
  autoTitlePatch,
  createDraftSession,
  emptyContextStatus,
  emptyMessagePage,
  isDraftSession,
  messagePageFromResponse,
  prependUniqueMessages,
  resolveNewConversationProject,
  SESSION_MESSAGES_PAGE_SIZE,
  sessionMessagesApiPath
} from './session-utils.js';

export function useSessionActions({
  defaultStatus,
  selectedProject,
  selectedProjectRef,
  selectedSessionRef,
  projects,
  sessionsByProject,
  expandedProjectIds,
  messages,
  messagesRef,
  autoTitleSyncRef,
  setExpandedProjectIds,
  setProjects,
  setSelectedProject,
  setSelectedSession,
  setSessionsByProject,
  setMessages,
  setMessagePage,
  setSessionLoadingId,
  setSessionLoadError,
  setContextStatus,
  setAttachments,
  setInput,
  invalidateAttachmentWrites,
  setDrawerOpen,
  loadSessions,
  upsertSessionInProject,
  clearSessionCompleteNotice
}) {
  async function handleToggleProject(project) {
    const isExpanded = Boolean(expandedProjectIds[project.id]);
    if (isExpanded) {
      setExpandedProjectIds((current) => {
        const next = { ...current };
        delete next[project.id];
        return next;
      });
      return;
    }

    setExpandedProjectIds((current) => ({ ...current, [project.id]: true }));
    const projectChanged = selectedProject?.id !== project.id;
    setSelectedProject(project);
    if (projectChanged) {
      selectedSessionRef.current = null;
      setSelectedSession(null);
      setMessages([]);
      setMessagePage(emptyMessagePage());
      setSessionLoadingId(null);
      setSessionLoadError('');
      setContextStatus(emptyContextStatus());
    }
    if (!sessionsByProject[project.id]) {
      await loadSessions(project, false);
    }
  }

  async function handleSelectSession(session) {
    clearSessionCompleteNotice(session?.id);
    selectedSessionRef.current = session;
    setSelectedSession(session);
    const requestedSessionId = session?.id || null;
    setSessionLoadError('');
    if (isDraftSession(session)) {
      setSessionLoadingId(null);
      setMessages([]);
      setMessagePage(emptyMessagePage());
      setContextStatus(emptyContextStatus());
      setDrawerOpen(false);
      return;
    }
    setSessionLoadingId(requestedSessionId);
    setMessages([]);
    setMessagePage(emptyMessagePage());
    setContextStatus(normalizeContextStatus(session?.context || defaultStatus.context, defaultStatus.context));
    setDrawerOpen(false);
    try {
      const data = await apiFetch(sessionMessagesApiPath(session.id));
      if (selectedSessionRef.current?.id !== requestedSessionId) {
        return;
      }
      const pendingInteractions = await apiFetch(`/api/chat/interactions?sessionId=${encodeURIComponent(session.id)}`)
        .then((result) => result.interactions || [])
        .catch(() => []);
      setMessages(
        pendingInteractions.reduce(
          (current, interaction) => upsertInteractionRequestMessage(current, { interaction, sessionId: session.id, turnId: interaction.turnId }),
          data.messages || []
        )
      );
      setMessagePage(messagePageFromResponse(data));
      setContextStatus(normalizeContextStatus(data.context || session.context || defaultStatus.context, defaultStatus.context));
    } catch (error) {
      if (selectedSessionRef.current?.id === requestedSessionId) {
        setSessionLoadError(error.message || '加载失败');
      }
    } finally {
      setSessionLoadingId((current) => (current === requestedSessionId ? null : current));
    }
  }

  async function refreshProjectSessions(project) {
    if (!project?.id) {
      return;
    }
    const [projectData, sessionData] = await Promise.all([
      apiFetch('/api/projects'),
      apiFetch(`/api/projects/${encodeURIComponent(project.id)}/sessions`)
    ]);
    const nextProjects = projectData.projects || [];
    setProjects(nextProjects);
    setSessionsByProject((current) => ({ ...current, [project.id]: sessionData.sessions || [] }));
    const nextSelectedProject = nextProjects.find((item) => item.id === selectedProjectRef.current?.id);
    if (nextSelectedProject) {
      setSelectedProject(nextSelectedProject);
    }
  }

  function firstUserMessageForTurn(turnId) {
    const scoped = (messagesRef.current || []).filter((message) => !turnId || message.turnId === turnId);
    return scoped.find((message) => message.role === 'user' && String(message.content || '').trim())?.content || '';
  }

  function applyAutoSessionTitle(payload, assistantContent) {
    const currentSession = selectedSessionRef.current;
    const projectId = payload.projectId || selectedProjectRef.current?.id || currentSession?.projectId;
    if (!currentSession || !projectId || currentSession.titleLocked) {
      return;
    }
    const userMessage = firstUserMessageForTurn(payload.turnId);
    const nextTitle = sessionTitleFromConversation({
      userMessage,
      assistantMessage: assistantContent
    });
    if (!nextTitle || nextTitle === currentSession.title) {
      return;
    }

    const ids = new Set([currentSession.id, payload.sessionId, payload.previousSessionId, payload.turnId].filter(Boolean));
    const patch = autoTitlePatch(nextTitle, 'completed');
    selectedSessionRef.current = { ...currentSession, ...patch };
    setSelectedSession((current) => (current && ids.has(current.id) ? { ...current, ...patch } : current));
    setSessionsByProject((current) => ({
      ...current,
      [projectId]: (current[projectId] || []).map((item) => (ids.has(item.id) ? { ...item, ...patch } : item))
    }));

    const sessionId = payload.sessionId || (!isDraftSession(currentSession) ? currentSession.id : '');
    if (!sessionId || isDraftSession(sessionId)) {
      return;
    }
    const syncKey = `${projectId}:${sessionId}:${nextTitle}`;
    if (autoTitleSyncRef.current.has(syncKey)) {
      return;
    }
    autoTitleSyncRef.current.add(syncKey);
    apiFetch(`/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: { title: nextTitle, auto: true }
    }).catch(() => {
      autoTitleSyncRef.current.delete(syncKey);
    });
  }

  async function handleRenameSession(project, session, requestedTitle = null) {
    if (!project?.id || !session?.id) {
      return false;
    }

    const currentTitle = session.title || '对话';
    const rawTitle = requestedTitle ?? (typeof window.prompt === 'function' ? window.prompt('重命名线程', currentTitle) : '');
    const nextTitle = String(rawTitle || '').trim().slice(0, 52);
    if (!nextTitle || nextTitle === currentTitle) {
      return false;
    }

    const applyLocalTitle = () => {
      setSessionsByProject((current) => ({
        ...current,
        [project.id]: (current[project.id] || []).map((item) =>
          item.id === session.id ? { ...item, title: nextTitle, titleLocked: true } : item
        )
      }));
      if (selectedSessionRef.current?.id === session.id) {
        setSelectedSession((current) => (current ? { ...current, title: nextTitle, titleLocked: true } : current));
      }
    };

    if (isDraftSession(session)) {
      applyLocalTitle();
      return true;
    }

    try {
      await apiFetch(`/api/projects/${encodeURIComponent(project.id)}/sessions/${encodeURIComponent(session.id)}`, {
        method: 'PATCH',
        body: { title: nextTitle }
      });
      applyLocalTitle();
      await refreshProjectSessions(project);
      return true;
    } catch (error) {
      window.alert(`重命名失败：${error.message}`);
      return false;
    }
  }

  async function handleDeleteSession(project, session) {
    if (!project?.id || !session?.id) {
      return;
    }

    const title = session.title || '\u5bf9\u8bdd';
    const confirmed = window.confirm(
      `\u5f52\u6863\u7ebf\u7a0b\u201c${title}\u201d\uff1f\u8fd9\u4f1a\u540c\u6b65\u5f52\u6863\u7535\u8111\u7aef Codex App \u91cc\u7684\u540c\u4e00\u4e2a\u5bf9\u8bdd\u3002`
    );
    if (!confirmed) {
      return;
    }

    const removeLocalSession = () => {
      setSessionsByProject((current) => ({
        ...current,
        [project.id]: (current[project.id] || []).filter((item) => item.id !== session.id)
      }));
      if (selectedSessionRef.current?.id === session.id) {
        setSelectedSession(null);
        setMessages([]);
        setMessagePage(emptyMessagePage());
        setSessionLoadingId(null);
        setSessionLoadError('');
        invalidateAttachmentWrites?.(session.id);
        setAttachments([]);
        setInput('');
      }
    };

    if (isDraftSession(session)) {
      removeLocalSession();
      return;
    }

    try {
      await apiFetch(`/api/projects/${encodeURIComponent(project.id)}/sessions/${encodeURIComponent(session.id)}`, {
        method: 'DELETE'
      });
      removeLocalSession();
      await refreshProjectSessions(project);
    } catch (error) {
      const message = String(error.message || '');
      window.alert(
        message.toLowerCase().includes('running')
          ? '\u7ebf\u7a0b\u6b63\u5728\u8fd0\u884c\uff0c\u7a0d\u540e\u518d\u5f52\u6863\u3002'
          : `\u5f52\u6863\u5931\u8d25\uff1a${message}`
      );
    }
  }

  async function handleDeleteMessage(message) {
    if (!message?.id) {
      return;
    }
    if (!window.confirm('删除这条消息？')) {
      return;
    }

    const messageId = String(message.id);
    const sessionId = selectedSessionRef.current?.id || message.sessionId || '';
    const existingIndex = messages.findIndex((item) => String(item.id) === messageId);
    const removedMessage = existingIndex >= 0 ? messages[existingIndex] : message;
    setMessages((current) => current.filter((item) => String(item.id) !== messageId));

    if (!sessionId || isDraftSession({ id: sessionId })) {
      return;
    }

    try {
      await apiFetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`,
        { method: 'DELETE' }
      );
    } catch (error) {
      setMessages((current) => {
        if (current.some((item) => String(item.id) === messageId)) {
          return current;
        }
        const next = [...current];
        const insertAt = existingIndex >= 0 ? Math.min(existingIndex, next.length) : next.length;
        next.splice(insertAt, 0, removedMessage);
        return next;
      });
      window.alert(`删除失败：${error.message}`);
    }
  }

  function handleNewConversation(targetProject = null) {
    const project = resolveNewConversationProject(targetProject, selectedProject, projects);
    if (!project) {
      return;
    }
    const draft = createDraftSession(project);
    selectedProjectRef.current = project;
    selectedSessionRef.current = draft;
    setSelectedProject(project);
    setSelectedSession(draft);
    setSessionLoadingId(null);
    setSessionLoadError('');
    setContextStatus(emptyContextStatus());
    setExpandedProjectIds((current) => ({ ...current, [project.id]: true }));
    setSessionsByProject((current) => upsertSessionInProject(current, project.id, draft));
    setMessages([]);
    setMessagePage(emptyMessagePage());
    invalidateAttachmentWrites?.(draft.id);
    setAttachments([]);
    setDrawerOpen(false);
  }

  async function handleLoadOlderMessages() {
    const session = selectedSessionRef.current;
    if (!session?.id || isDraftSession(session)) {
      return;
    }

    let request = null;
    setMessagePage((current) => {
      const page = current || emptyMessagePage();
      if (!page.hasMoreBefore || page.loadingOlder) {
        return page;
      }
      const currentOffset = Math.max(0, Number(page.offset) || 0);
      const nextOffset = Math.max(0, currentOffset - SESSION_MESSAGES_PAGE_SIZE);
      request = {
        offset: nextOffset,
        limit: Math.max(1, currentOffset - nextOffset)
      };
      return { ...page, loadingOlder: true };
    });
    if (!request) {
      return;
    }

    const sessionId = session.id;
    try {
      const data = await apiFetch(sessionMessagesApiPath(sessionId, {
        limit: request.limit,
        offset: request.offset,
        latest: false
      }));
      if (selectedSessionRef.current?.id !== sessionId) {
        return;
      }
      setMessages((current) => prependUniqueMessages(current, data.messages || []));
      setMessagePage(messagePageFromResponse(data));
      setContextStatus((current) =>
        normalizeContextStatus(data.context || current || session.context || defaultStatus.context, defaultStatus.context)
      );
    } catch (error) {
      if (selectedSessionRef.current?.id === sessionId) {
        setSessionLoadError(error.message || '加载更早消息失败');
      }
      setMessagePage((current) => ({ ...(current || emptyMessagePage()), loadingOlder: false }));
    }
  }

  return {
    handleToggleProject,
    handleSelectSession,
    handleLoadOlderMessages,
    handleRenameSession,
    handleDeleteSession,
    handleDeleteMessage,
    handleNewConversation,
    applyAutoSessionTitle,
    refreshProjectSessions
  };
}
