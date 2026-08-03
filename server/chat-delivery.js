/**
 * 聊天投递层：读取桌面桥状态并执行后台 headless Codex 队列。
 *
 * Keywords: desktop-ipc, headless-codex, bridge, codex-turn-input
 *
 * Exports:
 * - readDesktopBridgeStatus — 获取桌面桥状态；移动端发送不因桌面离线而失败。
 * - runQueuedHeadlessChatJob — 排队执行后台 Codex。
 *
 * Inward（本模块依赖/组装的关键符号）: codex-runner 风格的 runCodexTurn、session registration hooks。
 *
 * Outward（谁在用/调用场景）: chat-service。
 *
 * 不负责: HTTP 层与路由注册。
 */

import {
  broadcastDesktopThreadReadState,
  broadcastDesktopThreadStreamState
} from './desktop-ipc-client.js';

export async function readDesktopBridgeStatus(getDesktopBridgeStatus) {
  if (!getDesktopBridgeStatus) {
    return null;
  }
  try {
    return await getDesktopBridgeStatus({ force: true });
  } catch (error) {
    return {
      connected: false,
      mode: 'unavailable',
      reason: error?.message || 'desktop bridge unavailable'
    };
  }
}

export function runQueuedHeadlessChatJob({
  job,
  queueKey,
  state,
  sessionId,
  runCodexTurn,
  getCacheSnapshot = () => ({ projects: [] }),
  listProjectSessions = () => [],
  registerProjectlessThread,
  registerMobileSession,
  refreshCodexCache,
  broadcast,
  rememberConversationAlias,
  rememberTurn,
  rememberLiveSession,
  notifyDesktopThreadListChanged,
  triggerDesktopRefreshForThread,
  reportDesktopSyncStatus = () => null,
  requestCodexInteraction,
  resolveCodexInteraction,
  emitJobEvent,
  scheduleAutoNameCompletedSession,
  onQueueDrained
}) {
  const metadataUpdates = [];
  let lastBackgroundThread = null;
  let terminalEventSeen = false;
  let desktopRefreshRequested = false;

  function requestDesktopRefresh(threadId, reason) {
    if (desktopRefreshRequested || !threadId) {
      return;
    }
    desktopRefreshRequested = true;
    reportDesktopSyncStatus({
      sessionId: threadId,
      turnId: job.turnId,
      status: 'desktop_refresh_requested',
      detail: reason
    });
    Promise.resolve((async () => {
      const refresh = await triggerDesktopRefreshForThread?.(threadId, { reason });
      Promise.allSettled([
        broadcastDesktopThreadReadState(threadId, { hasUnreadTurn: true }),
        broadcastDesktopThreadStreamState(threadId, {
          status: reason.includes('completed') ? 'completed' : 'running',
          isStreaming: false
        })
      ]).then((results) => {
        if (refresh?.triggered) {
          return;
        }
        const ipcTriggered = results.some((result) => result.status === 'fulfilled' && result.value?.sent);
        if (ipcTriggered) {
          reportDesktopSyncStatus({
            sessionId: threadId,
            turnId: job.turnId,
            status: 'desktop_refresh_succeeded',
            detail: 'ipc-thread-changed'
          });
        }
      }).catch(() => null);
      if (refresh?.triggered) {
        reportDesktopSyncStatus({
          sessionId: threadId,
          turnId: job.turnId,
          status: 'desktop_refresh_succeeded',
          detail: refresh?.method || reason
        });
        return;
      }
      reportDesktopSyncStatus({
        sessionId: threadId,
        turnId: job.turnId,
        status: 'desktop_refresh_failed',
        detail: refresh?.error || refresh?.reason || '桌面端刷新失败'
      });
    })()).catch((error) => {
      reportDesktopSyncStatus({
        sessionId: threadId,
        turnId: job.turnId,
        status: 'desktop_refresh_failed',
        detail: error.message || '桌面端刷新失败'
      });
      console.warn('[desktop-refresh] Failed to trigger after chat:', error.message);
    });
  }

  function rememberStartedBackgroundThread(payload) {
    if (!payload?.sessionId || !job.draftSessionId) {
      return;
    }
    const updatedAt = payload.startedAt || new Date().toISOString();
    const visibleContent = job.visibleMessage || job.displayMessage;
    const sessionRecord = {
      id: payload.sessionId,
      projectId: job.project.id,
      projectPath: job.executionProjectPath || job.project.path,
      projectless: Boolean(job.project?.projectless),
      title: job.displayMessage,
      summary: job.displayMessage,
      updatedAt,
      filePath: payload.filePath || payload.path || null,
      messages: [
        {
          id: `${payload.sessionId}-user-${job.turnId}`,
          role: 'user',
          content: visibleContent,
          timestamp: updatedAt
        }
      ]
    };
    const backgroundThread = {
      threadId: payload.sessionId,
      cwd: payload.cwd || job.executionProjectPath || job.project.path || null
    };
    lastBackgroundThread = backgroundThread;
    rememberLiveSession?.(sessionRecord);
    metadataUpdates.push(
      Promise.all([
        job.project?.projectless
          ? registerProjectlessThread(payload.sessionId, job.project.path)
          : Promise.resolve(null),
        registerMobileSession(sessionRecord)
      ]).then(() =>
        notifyDesktopThreadListChanged?.({
          ...backgroundThread,
          reason: 'background-thread-started'
        })
      ).catch((error) => {
        console.warn('[sessions] Failed to register background thread:', error.message);
      })
    );
  }

  runCodexTurn(
    {
      sessionId,
      draftSessionId: job.draftSessionId,
      projectPath: job.executionProjectPath || job.project.path,
      message: job.codexMessage,
      attachments: job.attachments,
      selectedSkills: job.selectedSkills,
      model: job.model,
      reasoningEffort: job.reasoningEffort,
      serviceTier: job.serviceTier,
      permissionMode: job.permissionMode,
      collaborationMode: job.collaborationMode || null,
      turnId: job.turnId,
      onCodexServerRequest: requestCodexInteraction
        ? (appMessage, context) => requestCodexInteraction(job, appMessage, context)
        : null,
      onCodexServerRequestResolved: resolveCodexInteraction
        ? (params, context) => resolveCodexInteraction(job, params, context)
        : null
    },
    (payload) => {
      const eventPayload = {
        ...payload,
        source: payload?.source || 'headless-local'
      };
      if (['chat-complete', 'chat-error', 'chat-aborted'].includes(eventPayload.type)) {
        terminalEventSeen = true;
        reportDesktopSyncStatus({
          sessionId: eventPayload.sessionId || state.sessionId || sessionId || job.selectedSessionId || null,
          turnId: eventPayload.turnId || job.turnId,
          status: eventPayload.type === 'chat-complete'
            ? 'completed'
            : 'failed',
          detail: eventPayload.error || ''
        });
        requestDesktopRefresh(
          eventPayload.sessionId || state.sessionId || sessionId || job.selectedSessionId,
          lastBackgroundThread ? 'background-thread-completed' : 'headless-turn-completed'
        );
      }
      if (eventPayload.sessionId) {
        state.sessionId = eventPayload.sessionId;
        rememberConversationAlias(queueKey, eventPayload.sessionId);
      }
      if (eventPayload.previousSessionId) {
        rememberConversationAlias(queueKey, eventPayload.previousSessionId);
      }
      if (eventPayload.type === 'thread-started') {
        reportDesktopSyncStatus({
          sessionId: eventPayload.sessionId || state.sessionId || sessionId || job.selectedSessionId || null,
          turnId: eventPayload.turnId || job.turnId,
          status: 'codex_turn_started',
          detail: 'thread.started'
        });
        rememberStartedBackgroundThread(eventPayload);
      } else if (eventPayload.type === 'chat-started') {
        reportDesktopSyncStatus({
          sessionId: eventPayload.sessionId || state.sessionId || sessionId || job.selectedSessionId || null,
          turnId: eventPayload.turnId || job.turnId,
          status: 'codex_turn_started',
          detail: 'chat.started'
        });
        rememberStartedBackgroundThread(eventPayload);
      }
      emitJobEvent(job, eventPayload);
    }
  ).then(async (finalSessionId) => {
    if (finalSessionId) {
      state.sessionId = finalSessionId;
      rememberConversationAlias(queueKey, finalSessionId);
    }
    rememberTurn(job.turnId, {
      projectId: job.project.id,
      sessionId: finalSessionId || sessionId || job.selectedSessionId || job.draftSessionId || null,
      previousSessionId: job.draftSessionId || job.selectedSessionId || null
    });
    if (job.draftSessionId) {
      scheduleAutoNameCompletedSession({
        sessionId: finalSessionId || sessionId || job.selectedSessionId || null,
        turnId: job.turnId,
        userMessage: job.displayMessage
      });
    }
    if (!terminalEventSeen) {
      const completedAt = new Date().toISOString();
      terminalEventSeen = true;
      emitJobEvent(job, {
        type: 'chat-complete',
        source: 'headless-local',
        projectId: job.project.id,
        sessionId: finalSessionId || sessionId || job.selectedSessionId || null,
        previousSessionId: job.draftSessionId || job.selectedSessionId || null,
        turnId: job.turnId,
        completedAt,
        timestamp: completedAt
      });
    }
  }).catch((error) => {
    if (terminalEventSeen) {
      return;
    }
    const completedAt = new Date().toISOString();
    terminalEventSeen = true;
    emitJobEvent(job, {
      type: 'chat-error',
      source: 'headless-local',
      projectId: job.project.id,
      sessionId: state.sessionId || sessionId || job.selectedSessionId || null,
      previousSessionId: job.draftSessionId || job.selectedSessionId || null,
      turnId: job.turnId,
      error: error?.message || '任务失败',
      completedAt,
      timestamp: completedAt
    });
  }).finally(async () => {
    state.running = false;
    if (state.jobs.length) {
      onQueueDrained?.();
    }
    try {
      if (metadataUpdates.length) {
        await Promise.allSettled(metadataUpdates);
      }
      const snapshot = await refreshCodexCache();
      broadcast({
        type: 'sync-complete',
        syncedAt: snapshot?.syncedAt || null,
        projects: (getCacheSnapshot().projects || []).map((project) => ({
          ...project,
          sessions: listProjectSessions(project.id)
        }))
      });
      const refreshThreadId = lastBackgroundThread?.threadId || state.sessionId || sessionId || job.selectedSessionId || null;
      if (lastBackgroundThread) {
        await notifyDesktopThreadListChanged?.({
          ...lastBackgroundThread,
          reason: 'background-thread-completed'
        });
      }
      if (refreshThreadId) {
        requestDesktopRefresh(
          refreshThreadId,
          lastBackgroundThread ? 'background-thread-completed' : 'headless-turn-completed'
        );
      }
    } catch (error) {
      console.warn('[sync] Failed to refresh after chat:', error.message);
    }
  });
}
