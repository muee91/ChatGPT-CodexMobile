/**
 * 空闲时拉取选中会话消息并做轻量合并，作为 WebSocket sync events 的补账层。
 *
 * Keywords: idle-polling, session-messages, reconcile
 *
 * Exports:
 * - shouldPollSelectedSession — 判断当前选中会话是否应发起补账轮询。
 * - `useSessionLivePolling` — 基于认证与选中会话驱动轮询的 effect hook。
 *
 * Inward: `api`、`session-live-refresh`、`activity-model` 签名、`session-utils`。
 *
 * Outward: `App.jsx` 与会话实时展示链路配合。
 */

import { useEffect } from 'react';
import { apiFetch } from '../api.js';
import {
  mergeLiveSelectedThreadMessages
} from '../session-live-refresh.js';
import { mergeContextStatus } from './context-status.js';
import {
  isDraftSession,
  sessionMessagesApiPath
} from './session-utils.js';

export function shouldPollSelectedSession({
  authenticated,
  selectedSession,
  running,
  pollInFlight
} = {}) {
  if (!authenticated || !selectedSession?.id || isDraftSession(selectedSession)) {
    return false;
  }
  if (pollInFlight) {
    return false;
  }
  if (running) {
    return false;
  }
  return true;
}

export function useSessionLivePolling({
  authenticated,
  selectedSession,
  running,
  defaultStatus,
  sessionLivePollRef,
  selectedSessionRef,
  setContextStatus,
  setMessages
}) {
  useEffect(() => {
    if (!authenticated || !selectedSession?.id || isDraftSession(selectedSession)) {
      return undefined;
    }

    const sessionId = selectedSession.id;
    let stopped = false;
    async function pollSelectedSession() {
      if (
        stopped ||
        !shouldPollSelectedSession({
          authenticated,
          selectedSession,
          running,
          pollInFlight: sessionLivePollRef.current
        })
      ) {
        return;
      }
      sessionLivePollRef.current = true;
      try {
        const data = await apiFetch(sessionMessagesApiPath(sessionId));
        if (!stopped && selectedSessionRef.current?.id === sessionId && Array.isArray(data.messages)) {
          setContextStatus((current) => mergeContextStatus(current, data.context || defaultStatus.context, defaultStatus.context));
          setMessages((current) =>
            mergeLiveSelectedThreadMessages(current, data.messages, { forceDropStaleRunning: true })
          );
        }
      } catch {
        // Keep the currently rendered conversation if a transient poll fails.
      } finally {
        sessionLivePollRef.current = false;
      }
    }

    const intervalMs = 1800;
    const timer = window.setInterval(pollSelectedSession, intervalMs);
    pollSelectedSession();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [
    authenticated,
    selectedSession?.id,
    running
  ]);
}
