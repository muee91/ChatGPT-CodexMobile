/**
 * 聊天主滚动区：会话切换时跟底、显示回到底部按钮，并把文件卡片挂到结果下方。
 *
 * Keywords: ChatPane, scroll, chat messages
 *
 * Exports:
 * - ChatPane — 包裹 ChatMessage 列表与底部对齐逻辑。
 *
 * Inward: ../chat-scroll.js、ChatMessage.jsx、ActivityLiveProgress、chat-render-items。
 *
 * Outward: App.jsx
 */

import { AlertCircle, ArrowDown, Loader2, ShieldCheck } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isNearChatBottom, shouldFollowChatOutput } from '../chat-scroll.js';
import { ActivityFileSummary } from './ActivityFileSummary.jsx';
import { ActivityLiveProgress } from './ActivityLiveProgress.jsx';
import { ChatMessage } from './ChatMessage.jsx';
import { chatRenderItems } from './chat-render-items.js';

function ChatPaneView({
  messages,
  selectedSession,
  loading = false,
  loadError = '',
  running,
  activeRuntimeStartedAt = null,
  now,
  hasMoreBefore = false,
  loadingOlder = false,
  onLoadOlderMessages,
  onPreviewImage,
  onDeleteMessage,
  onImplementPlan,
  onAdjustPlan
}) {
  const paneRef = useRef(null);
  const contentRef = useRef(null);
  const bottomPinnedRef = useRef(true);
  const pendingInitialScrollSessionRef = useRef(null);
  const [showScrollLatest, setShowScrollLatest] = useState(false);
  const handlersRef = useRef({
    onLoadOlderMessages,
    onDeleteMessage,
    onImplementPlan,
    onAdjustPlan
  });
  const hasMessages = messages.length > 0;
  const sessionId = selectedSession?.id || '';
  const pinnedBeforeRender = bottomPinnedRef.current;
  const hasStreamingAssistant = useMemo(
    () => messages.some((message) => message?.role === 'assistant' && message?.streaming),
    [messages]
  );
  const renderItems = useMemo(
    () => chatRenderItems(messages, { running: running && !hasStreamingAssistant }),
    [hasStreamingAssistant, messages, running]
  );

  useEffect(() => {
    handlersRef.current = {
      onLoadOlderMessages,
      onDeleteMessage,
      onImplementPlan,
      onAdjustPlan
    };
  }, [onLoadOlderMessages, onDeleteMessage, onImplementPlan, onAdjustPlan]);

  const scrollToBottom = useCallback((behavior = 'auto') => {
    const pane = paneRef.current;
    if (!pane) {
      return;
    }
    pane.scrollTo({ top: pane.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) {
      return undefined;
    }

    function updatePinnedState() {
      const pinned = isNearChatBottom(pane);
      bottomPinnedRef.current = pinned;
      setShowScrollLatest(!pinned);
    }

    updatePinnedState();
    pane.addEventListener('scroll', updatePinnedState, { passive: true });
    return () => pane.removeEventListener('scroll', updatePinnedState);
  }, [hasMessages]);

  useLayoutEffect(() => {
    const force = Boolean(hasMessages && sessionId && pendingInitialScrollSessionRef.current === sessionId);
    if (!shouldFollowChatOutput({ pinnedToBottom: bottomPinnedRef.current, pinnedBeforeUpdate: pinnedBeforeRender, running, force })) {
      return undefined;
    }
    scrollToBottom('auto');
    setShowScrollLatest(false);
    bottomPinnedRef.current = true;
    if (force) {
      pendingInitialScrollSessionRef.current = null;
    }
    return undefined;
  }, [messages, running, scrollToBottom, hasMessages, sessionId]);

  const handleLoadOlderMessagesClick = useCallback(() => {
    handlersRef.current.onLoadOlderMessages?.();
  }, []);

  const handleDeleteMessage = useCallback((message) => {
    handlersRef.current.onDeleteMessage?.(message);
  }, []);

  const handleImplementPlan = useCallback((planImplementation) => {
    handlersRef.current.onImplementPlan?.(planImplementation);
  }, []);

  const handleAdjustPlan = useCallback((message, planImplementation) => {
    handlersRef.current.onAdjustPlan?.(message, planImplementation);
  }, []);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      if (shouldFollowChatOutput({ pinnedToBottom: bottomPinnedRef.current, running })) {
        scrollToBottom('auto');
      }
    });
    observer.observe(contentRef.current || pane);
    return () => observer.disconnect();
  }, [running, scrollToBottom]);

  useLayoutEffect(() => {
    pendingInitialScrollSessionRef.current = selectedSession?.id || null;
    bottomPinnedRef.current = true;
    setShowScrollLatest(false);
    scrollToBottom('auto');
    return undefined;
  }, [selectedSession?.id, scrollToBottom]);

  if (loading) {
    return (
      <section className="chat-pane chat-loading" ref={paneRef} aria-busy="true" aria-live="polite">
        <div className="chat-loading-card">
          <Loader2 className="spin" size={22} />
          <div>
            <strong>{selectedSession?.title || '对话'}</strong>
            <span>正在加载消息</span>
          </div>
        </div>
        <div className="chat-loading-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="chat-pane chat-load-error" ref={paneRef} role="alert">
        <div className="empty-orbit">
          <AlertCircle size={30} />
        </div>
        <h2>加载失败</h2>
        <p>{loadError}</p>
      </section>
    );
  }

  if (!messages.length) {
    return (
      <section className="chat-pane empty-chat">
        <div className="empty-orbit">
          <ShieldCheck size={30} />
        </div>
        <h2>{selectedSession ? selectedSession.title : '新对话'}</h2>
        <p>问 Codex 任何事。</p>
      </section>
    );
  }

  return (
    <section className="chat-pane" ref={paneRef}>
      <div className="chat-content" ref={contentRef}>
        {hasMoreBefore ? (
          <div className="message-history-gate">
            <button
              type="button"
              className="message-history-button"
              onClick={handleLoadOlderMessagesClick}
              disabled={loadingOlder}
            >
              {loadingOlder ? <Loader2 className="spin" size={15} /> : null}
              <span>{loadingOlder ? '正在加载更早消息' : '加载更早消息'}</span>
            </button>
          </div>
        ) : null}
        {renderItems.map((item) => {
          if (item.type === 'fileSummary') {
            return (
              <div key={item.key} className="message-row is-file-summary">
                <ActivityFileSummary summary={item.summary} />
              </div>
            );
          }
          if (item.type === 'liveActivity') {
            return (
              <ActivityLiveProgress
                key={item.key}
                message={item.message}
                running={running}
                startedAt={activeRuntimeStartedAt}
                now={now}
              />
            );
          }
          return (
            <ChatMessage
              key={item.key}
              message={item.message}
              now={now}
              afterContent={item.fileSummaries?.map((summary, index) => (
                <ActivityFileSummary key={`${item.key}-file-summary-${index}`} summary={summary} />
              ))}
              onPreviewImage={onPreviewImage}
              onDeleteMessage={handleDeleteMessage}
              onImplementPlan={handleImplementPlan}
              onAdjustPlan={handleAdjustPlan}
            />
          );
        })}
      </div>
      {showScrollLatest ? (
        <button
          type="button"
          className="scroll-latest-button"
          onClick={() => {
            scrollToBottom('smooth');
            bottomPinnedRef.current = true;
            setShowScrollLatest(false);
          }}
          aria-label="回到最新消息"
        >
          <ArrowDown size={16} />
        </button>
      ) : null}
    </section>
  );
}

function chatPanePropsEqual(previous, next) {
  return (
    previous.messages === next.messages &&
    previous.selectedSession?.id === next.selectedSession?.id &&
    previous.selectedSession?.title === next.selectedSession?.title &&
    previous.loading === next.loading &&
    previous.loadError === next.loadError &&
    previous.running === next.running &&
    previous.activeRuntimeStartedAt === next.activeRuntimeStartedAt &&
    previous.now === next.now &&
    previous.hasMoreBefore === next.hasMoreBefore &&
    previous.loadingOlder === next.loadingOlder &&
    previous.onPreviewImage === next.onPreviewImage
  );
}

export const ChatPane = memo(ChatPaneView, chatPanePropsEqual);
