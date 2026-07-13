/**
 * WebSocket 入站连接器：只消费 connected 与统一 sync payload，旧 live payload 不再直接驱动 UI。
 *
 * Keywords: websocket, sync-state, sync-event, connection
 *
 * Exports:
 * - 若干 `should*` 纯函数 — 旧测试兼容守卫，统一返回不直连旧 UI。
 * - useAppWebSocket — 建立 WS 连接并把 sync payload 分发到同步消费层。
 *
 * Inward: api、sync/useSyncSocket、model-sync、session-live-refresh。
 *
 * Outward: App.jsx 根编排。
 */

import { apiFetch, websocketUrl } from '../api.js';
import { applySessionRenameToProjectSessions } from '../session-live-refresh.js';
import { mergeModelSettingsIntoStatus, shouldApplyModelSettings } from './model-sync.js';
import { normalizeContextStatus } from './context-status.js';
import { applySyncSocketPayload } from '../sync/useSyncSocket.js';
import { selectRuntimeForSession } from '../sync/sync-selectors.js';

export function projectShellsFromSyncProjects(projects = []) {
  return projects.map(({ sessions, ...project }) => project);
}

export function sessionsByProjectFromSyncProjects(projects = []) {
  return Object.fromEntries(
    projects
      .filter((project) => project?.id && Array.isArray(project.sessions))
      .map((project) => [
        project.id,
        project.sessions.map((session) => ({
          ...session,
          projectId: session?.projectId || project.id
        }))
      ])
  );
}

function selectedSessionChanged(refreshedSession = null, currentSession = null) {
  if (!refreshedSession || !currentSession) {
    return false;
  }
  return (
    String(refreshedSession.updatedAt || '') !== String(currentSession.updatedAt || '') ||
    String(refreshedSession.summary || '') !== String(currentSession.summary || '')
  );
}

export function isExternalThreadPayload(payload = {}) {
  void payload;
  return false;
}

export function isDesktopThreadStatusPayload(payload = {}) {
  void payload;
  return false;
}

export function shouldRenderStatusMessageForPayload(payload = {}) {
  void payload;
  return false;
}

export function shouldRenderActivityMessageForPayload(payload = {}) {
  void payload;
  return false;
}

export function shouldRenderAssistantMessageForPayload(payload = {}) {
  void payload;
  return false;
}

export function shouldRefreshDesktopThreadForPayload(payload = {}) {
  void payload;
  return false;
}

export function shouldCompleteLocalTurnBeforeRefresh(payload = {}) {
  void payload;
  return false;
}

export function shouldRefreshCurrentSessionAfterReconnect(session = null) {
  const sessionId = String(session?.id || '').trim();
  return Boolean(sessionId && !sessionId.startsWith('draft-'));
}

function coalescedAssistantDeltaKey(payload = {}) {
  const eventType = String(payload.event?.eventType || '').trim().toLowerCase();
  if (payload.type !== 'sync-event' || eventType !== 'message.assistant.delta') {
    return '';
  }
  const event = payload.event || {};
  return [
    event.sessionId || event.message?.sessionId || '',
    event.turnId || event.clientTurnId || event.message?.turnId || '',
    event.message?.id || event.messageId || 'assistant'
  ].join(':');
}

export function coalesceSyncPayloads(payloads = []) {
  const result = [];
  const coalescedIndexByKey = new Map();
  for (const payload of payloads) {
    const key = coalescedAssistantDeltaKey(payload);
    if (!key) {
      result.push(payload);
      continue;
    }
    const existingIndex = coalescedIndexByKey.get(key);
    if (existingIndex === undefined) {
      coalescedIndexByKey.set(key, result.length);
      result.push(payload);
      continue;
    }
    result[existingIndex] = payload;
  }
  return result;
}

export function selectedSessionHasLiveAuthority(selectedSession = null, runningById = {}, runtimeById = {}) {
  if (!selectedSession) {
    return false;
  }
  const runtime = selectRuntimeForSession(selectedSession, runtimeById);
  if (runtime?.status === 'running' || runtime?.status === 'queued') {
    return true;
  }
  return [selectedSession.id, selectedSession.turnId, selectedSession.previousSessionId]
    .filter(Boolean)
    .some((key) => Boolean(runningById?.[String(key)]));
}

export function useAppWebSocket({
  useEffect,
  authenticated,
  defaultStatus,
  wsRef,
  selectedProjectRef,
  selectedSessionRef,
  setConnectionState,
  setStatus,
  setRunningById,
  runningByIdRef,
  threadRuntimeByIdRef,
  setThreadRuntimeById,
  setSelectedSession,
  setSessionsByProject,
  setMessages,
  setContextStatus,
  setLiveContextStatus,
  setProjects,
  setSelectedProject,
  setExpandedProjectIds,
  loadSessions,
  loadQueueDrafts,
  moveComposerDraftState,
  markRun,
  clearRun,
  markSessionCompleteNotice,
  markTurnCompleted,
  scheduleTurnRefresh,
  upsertSessionInProject,
  onAuthRevoked
}) {
  useEffect(() => {
    if (!authenticated) {
      setConnectionState('disconnected');
      return undefined;
    }

    let stopped = false;
    let reconnectTimer = null;
    let pendingPayloads = [];
    let payloadFlushFrame = null;
    let queueRefreshTimer = null;

    // Keep the synchronous refs aligned with the reducer before processing the
    // snapshot's project/context branch in the same incoming WebSocket frame.
    function setSyncThreadRuntimeById(update) {
      const current = threadRuntimeByIdRef.current || {};
      const next = typeof update === 'function' ? update(current) : update;
      threadRuntimeByIdRef.current = next || {};
      setThreadRuntimeById(next || {});
      return next || {};
    }

    function applyModelFromSyncPayload(payload = {}) {
      const settings =
        payload.type === 'sync-state'
          ? payload.state?.modelSettings
          : payload.event?.eventType === 'model.updated'
            ? payload.event
            : null;
      if (settings && shouldApplyModelSettings(settings, selectedSessionRef.current)) {
        setStatus((current) => mergeModelSettingsIntoStatus(current, settings));
      }
    }

    function handleThreadRenamed(event = {}) {
      const sessionId = event.sessionId || event.session?.id;
      const projectId = event.projectId || event.session?.projectId;
      const title = String(event.title || event.session?.title || '').trim();
      if (!sessionId || !projectId || !title) {
        return;
      }
      const renamePayload = {
        type: 'session-renamed',
        projectId,
        sessionId,
        title,
        titleLocked: event.titleLocked ?? event.session?.titleLocked ?? true,
        updatedAt: event.timestamp,
        session: event.session
      };
      setSessionsByProject((current) => applySessionRenameToProjectSessions(current, renamePayload));
      setSelectedSession((current) => {
        if (!current || String(current.id) !== String(sessionId)) {
          return current;
        }
        return { ...current, ...(event.session || {}), id: sessionId, projectId, title };
      });
    }

    function handleSessionsSynced(event = {}) {
      if (!Array.isArray(event.projects)) {
        return { projectShells: [], syncedSessionsByProject: {}, refreshedSession: null, shouldRefreshSelectedMessages: false };
      }
      const projectShells = projectShellsFromSyncProjects(event.projects);
      const syncedSessionsByProject = sessionsByProjectFromSyncProjects(event.projects);
      const currentSession = selectedSessionRef.current;
      const currentProjectId = String(currentSession?.projectId || '').trim();
      if (currentProjectId) {
        const projectSessions = Array.isArray(syncedSessionsByProject[currentProjectId])
          ? syncedSessionsByProject[currentProjectId]
          : [];
        const hasCurrentSession = projectSessions.some((session) => String(session?.id || '') === String(currentSession?.id || ''));
        if (!hasCurrentSession && currentSession?.id) {
          syncedSessionsByProject[currentProjectId] = [currentSession, ...projectSessions];
        }
      }
      setProjects(projectShells);
      if (Object.keys(syncedSessionsByProject).length) {
        setSessionsByProject((current) => ({
          ...current,
          ...syncedSessionsByProject
        }));
      }
      const project = selectedProjectRef.current;
      if (!project?.id) {
        const preferred =
          projectShells.find((item) => item.name.toLowerCase() === 'codexmobile') ||
          projectShells.find((item) => item.path.toLowerCase().includes('codexmobile')) ||
          projectShells[0] ||
          null;
        if (preferred) {
          setSelectedProject(preferred);
          setExpandedProjectIds((current) => ({ ...current, [preferred.id]: true }));
          loadSessions(preferred, {
            chooseLatest: false,
            preserveSelection: true
          }).catch(() => null);
        }
        return { projectShells, syncedSessionsByProject, refreshedSession: null, shouldRefreshSelectedMessages: false };
      }
      const nextSessions = syncedSessionsByProject[project.id];
      if (!Array.isArray(nextSessions)) {
        return { projectShells, syncedSessionsByProject, refreshedSession: null, shouldRefreshSelectedMessages: false };
      }
      const liveAuthority = selectedSessionHasLiveAuthority(
        currentSession,
        runningByIdRef.current,
        threadRuntimeByIdRef?.current || {}
      );
      const refreshedSession = nextSessions.find((session) => session.id === currentSession?.id);
      if (refreshedSession) {
        const shouldRefreshSelectedMessages = !liveAuthority && selectedSessionChanged(refreshedSession, currentSession);
        setSelectedSession((current) => (current?.id === refreshedSession.id ? { ...current, ...refreshedSession } : current));
        if (!liveAuthority) {
          setContextStatus(normalizeContextStatus(refreshedSession.context || defaultStatus.context, defaultStatus.context));
        }
        if (shouldRefreshSelectedMessages) {
          loadSessions(project, {
            chooseLatest: false,
            preferredSessionId: refreshedSession.id,
            preserveSelection: true,
            silent: true
          }).catch(() => null);
        }
      }
      return {
        projectShells,
        syncedSessionsByProject,
        refreshedSession,
        shouldRefreshSelectedMessages: !liveAuthority && selectedSessionChanged(refreshedSession, currentSession)
      };
    }

    async function resyncFromServer({ refreshCurrentSelection = false } = {}) {
      const syncResult = await apiFetch('/api/sync', { method: 'POST' }).catch(() => null);
      if (!syncResult) {
        return null;
      }
      const syncOutcome = Array.isArray(syncResult.projects)
        ? handleSessionsSynced({ projects: syncResult.projects })
        : null;
      if (syncResult.syncedAt) {
        setStatus((current) => ({ ...current, syncedAt: syncResult.syncedAt }));
      }
      if (!refreshCurrentSelection) {
        return syncResult;
      }
      const project = selectedProjectRef.current;
      const session = selectedSessionRef.current;
      if (!project?.id || !shouldRefreshCurrentSessionAfterReconnect(session) || syncOutcome?.shouldRefreshSelectedMessages) {
        return syncResult;
      }
      await loadSessions(project, {
        chooseLatest: false,
        preferredSessionId: session.id,
        preserveSelection: true,
        silent: true
      });
      return syncResult;
    }

    async function refreshCurrentSessionAfterReconnect() {
      await resyncFromServer({ refreshCurrentSelection: true });
    }

    function applySyncPayload(payload = {}) {
      applyModelFromSyncPayload(payload);
      applySyncSocketPayload(payload, {
        defaultStatus,
        selectedProjectRef,
        selectedSessionRef,
        setRunningById,
        runningByIdRef,
        setThreadRuntimeById: setSyncThreadRuntimeById,
        markRun,
        clearRun,
        markSessionCompleteNotice,
        markTurnCompleted,
        scheduleTurnRefresh,
        setMessages,
        setContextStatus,
        setLiveContextStatus,
        setProjects,
        setSelectedSession,
        setSessionsByProject,
        moveComposerDraftState,
        upsertSessionInProject,
        handleThreadRenamed
      });
      if (payload.type === 'sync-state' && Array.isArray(payload.state?.projects)) {
        handleSessionsSynced({ projects: payload.state.projects });
      }
      if (payload.type === 'sync-event' && payload.event?.eventType === 'sessions.synced') {
        handleSessionsSynced(payload.event);
      }
      scheduleQueueRefreshForPayload(payload);
    }

    function eventMatchesSelectedSession(event = {}) {
      const selected = selectedSessionRef.current;
      if (!selected?.id) {
        return false;
      }
      const selectedIds = [
        selected.id,
        selected.turnId,
        selected.previousSessionId,
        selected.draftSessionId
      ].filter(Boolean).map(String);
      return [
        event.sessionId,
        event.previousSessionId,
        event.draftSessionId,
        event.turnId,
        event.clientTurnId
      ].some((value) => value && selectedIds.includes(String(value)));
    }

    function scheduleQueueRefreshForPayload(payload = {}) {
      if (payload.type !== 'sync-event' || !loadQueueDrafts) {
        return;
      }
      const event = payload.event || {};
      const eventType = String(event.eventType || '');
      if (!eventType.startsWith('turn.') || !eventMatchesSelectedSession(event)) {
        return;
      }
      if (queueRefreshTimer) {
        window.clearTimeout(queueRefreshTimer);
      }
      queueRefreshTimer = window.setTimeout(() => {
        queueRefreshTimer = null;
        loadQueueDrafts(selectedSessionRef.current).catch(() => null);
      }, 150);
    }

    function flushPendingPayloads() {
      payloadFlushFrame = null;
      const nextPayloads = coalesceSyncPayloads(pendingPayloads);
      pendingPayloads = [];
      for (const payload of nextPayloads) {
        applySyncPayload(payload);
      }
    }

    function enqueueSyncPayload(payload = {}) {
      if (payload.type !== 'sync-event' || payload.event?.eventType !== 'message.assistant.delta') {
        if (payloadFlushFrame !== null) {
          window.cancelAnimationFrame(payloadFlushFrame);
          flushPendingPayloads();
        }
        applySyncPayload(payload);
        return;
      }
      pendingPayloads.push(payload);
      if (payloadFlushFrame !== null) {
        return;
      }
      payloadFlushFrame = window.requestAnimationFrame(flushPendingPayloads);
    }

    const connect = () => {
      setConnectionState('connecting');
      const ws = new WebSocket(websocketUrl());
      wsRef.current = ws;

      ws.onopen = () => setConnectionState('connecting');
      ws.onclose = (event) => {
        setConnectionState('disconnected');
        if (event.code === 1008 || String(event.reason || '').toLowerCase().includes('revoked')) {
          stopped = true;
          onAuthRevoked?.();
          return;
        }
        if (!stopped) {
          reconnectTimer = window.setTimeout(connect, 1200);
        }
      };
      ws.onerror = () => setConnectionState('disconnected');
      ws.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === 'connected') {
          setStatus(payload.status || defaultStatus);
          setConnectionState(payload.status?.connected ? 'connected' : 'disconnected');
          if (payload.status?.syncState) {
            applySyncPayload({ type: 'sync-state', state: payload.status.syncState });
          }
          if (payload.status?.connected) {
            refreshCurrentSessionAfterReconnect().catch(() => null);
          }
          return;
        }
        if (payload.type === 'sync-state' || payload.type === 'sync-event') {
          enqueueSyncPayload(payload);
        }
      };
    };

    connect();

    const resyncOnForeground = () => {
      if (stopped) {
        return;
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      resyncFromServer({ refreshCurrentSelection: true }).catch(() => null);
    };
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        resyncOnForeground();
      }
    };
    const resyncInterval = window.setInterval(resyncOnForeground, 15000);
    window.addEventListener('focus', resyncOnForeground);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopped = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      if (payloadFlushFrame !== null) {
        window.cancelAnimationFrame(payloadFlushFrame);
      }
      if (queueRefreshTimer) {
        window.clearTimeout(queueRefreshTimer);
      }
      window.clearInterval(resyncInterval);
      window.removeEventListener('focus', resyncOnForeground);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      wsRef.current?.close();
      setConnectionState('disconnected');
    };
  }, [authenticated, loadQueueDrafts]);
}
