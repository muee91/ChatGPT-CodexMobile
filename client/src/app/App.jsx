/**
 * CodexMobile Web：根级应用编排——认证门禁、服务端状态与 WS、会话/文件管理数据流、把 props 下发给 Shell。
 *
 * Keywords: pairing, websocket, bootstrap, session-orchestration, file-manager, composer-props
 *
 * Exports:
 * - default — `App`（入口挂载的根组件）。
 *
 * Inward（本模块组装）: `PairingScreen`, `AppShell`；多处 `use*` hooks（bootstrap / session / submit / runtime / uploads 等）；
 *   `session-utils`、`api`、`AppState` 与 file-manager reducer。
 *
 * Outward（谁消费）: 应用入口（如 `main`）仅挂载本 default；DOM 拼装见 `AppShell.jsx`。
 *
 * 不负责: 页面区域的具体布局与样式、`Composer`/`ChatPane` 内部交互实现。
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { apiFetch, clearToken, getToken } from '../api.js';
import {
  DEFAULT_MODEL_SPEED,
  normalizeModelSpeed,
  normalizePermissionModeForSecurity,
  readStoredPermissionMode,
  writeStoredPermissionMode
} from '../composer/composer-options.js';
import { useComposerSelections } from '../composer/useComposerSelections.js';
import { useQueueDrafts } from '../composer/useQueueDrafts.js';
import { connectionRecoveryState } from '../connection-recovery.js';
import { createInitialFileManagerState, fileManagerReducer, rememberFileManagerView } from '../file-manager-state.js';
import { mergeContextStatus, normalizeContextStatus } from './context-status.js';
import { DEFAULT_REASONING_EFFORT, DEFAULT_STATUS, REASONING_DEFAULT_VERSION } from './defaults.js';
import { appReducer, createInitialUiState, THEME_KEY } from './AppState.js';
import { useNotifications } from '../panels/useNotifications.js';
import { useAppBootstrap } from './useAppBootstrap.js';
import { useConnectionActions } from './useConnectionActions.js';
import { useDocsActions } from './useDocsActions.js';
import { useFileUploads } from './useFileUploads.js';
import { useAppWebSocket } from './useAppWebSocket.js';
import { upsertActivityMessage } from '../chat/activity-model.js';
import { useSessionLivePolling } from './useSessionLivePolling.js';
import { useSessionActions } from './useSessionActions.js';
import { useTurnSubmission } from './useTurnSubmission.js';
import { useTurnRuntime } from './useTurnRuntime.js';
import { useViewportSizing } from './useViewportSizing.js';
import { usePwaUpdate } from './pwa-update.js';
import { applyPwaTheme } from './pwa-theme.js';
import { effectiveComposerSettingsSource, mergeModelSettingsIntoStatus, nextSyncedComposerSettings } from './model-sync.js';
import { rememberSelectedSession } from './selection-persistence.js';
import {
  emptyContextStatus,
  emptyMessagePage,
  hasRunningKey,
  isDraftSession,
  reconcileThreadRuntimeWithSessions,
  resolveComposerGitProject,
  selectedMessagesHaveActiveTurnActivity,
  selectedRunKeys,
  sessionRunKeys,
  selectedSessionIsRunning,
  upsertSessionInProject
} from './session-utils.js';
import { AppShell } from './AppShell.jsx';
import PairingScreen from './PairingScreen.jsx';
import {
  selectRuntimeForSession,
  syncRunningByIdFromRuntime
} from '../sync/sync-selectors.js';

const MODEL_SPEED_KEY = 'codexmobile.modelSpeed';
const DESKTOP_SHELL_MEDIA = '(min-width: 1024px)';
const GENERIC_RUNNING_RUNTIME = Object.freeze({ status: 'running' });
const EMPTY_COMPOSER_DRAFT = Object.freeze({
  input: '',
  attachments: [],
  fileMentions: [],
  collaborationMode: null,
  selectedSkillPaths: []
});

function composerDraftKeyForSelection(session, project) {
  if (session?.id) {
    return String(session.id);
  }
  if (project?.id) {
    return `project:${project.id}`;
  }
  return 'project:none';
}

function normalizeComposerDraft(draft = null) {
  return {
    input: typeof draft?.input === 'string' ? draft.input : '',
    attachments: Array.isArray(draft?.attachments) ? draft.attachments : [],
    fileMentions: Array.isArray(draft?.fileMentions) ? draft.fileMentions : [],
    collaborationMode: draft?.collaborationMode === 'plan' ? 'plan' : null,
    selectedSkillPaths: Array.isArray(draft?.selectedSkillPaths) ? draft.selectedSkillPaths.filter(Boolean) : []
  };
}

function resolveStateUpdate(nextValue, previousValue) {
  return typeof nextValue === 'function' ? nextValue(previousValue) : nextValue;
}

function gitBranchDraft(project) {
  const name = String(project?.name || 'changes')
    .trim()
    .toLowerCase()
    .replace(/^codex\//, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return `codex/${name || 'changes'}`;
}

function gitChangedFileCount(status = {}) {
  if (Number.isFinite(status.fileCount)) {
    return status.fileCount;
  }
  return Array.isArray(status.files) ? status.files.length : 0;
}

function gitNeedsExplicitConfirm(status = {}) {
  return gitChangedFileCount(status) > 50 || (status.branch && !String(status.branch).startsWith('codex/'));
}

export default function App() {
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [snapshotContextStatus, setSnapshotContextStatus] = useState(() => normalizeContextStatus(DEFAULT_STATUS.context));
  const [liveContextStatus, setLiveContextStatus] = useState(() => emptyContextStatus());
  const [authenticated, setAuthenticated] = useState(Boolean(getToken()));
  const [uiState, dispatchUi] = useReducer(appReducer, undefined, () => createInitialUiState());
  const [fileManager, dispatchFileManager] = useReducer(fileManagerReducer, undefined, () => createInitialFileManagerState());
  const setDrawerOpen = useCallback((value) => dispatchUi({ type: 'ui/drawerOpen', value }), []);
  const setPreviewImage = useCallback((value) => dispatchUi({ type: 'ui/previewImage', value }), []);
  const setDocsOpen = useCallback((value) => dispatchUi({ type: 'ui/docsOpen', value }), []);
  const setDocsBusy = useCallback((value) => dispatchUi({ type: 'ui/docsBusy', value }), []);
  const setDocsError = useCallback((value) => dispatchUi({ type: 'ui/docsError', value }), []);
  const setGitPanel = useCallback((value) => dispatchUi({ type: 'ui/gitPanel', value }), []);
  const setTheme = useCallback((value) => dispatchUi({ type: 'ui/theme', value }), []);
  const { drawerOpen, previewImage, docsOpen, docsBusy, docsError, gitPanel, theme } = uiState;
  const {
    toasts,
    notificationSupported,
    notificationEnabled,
    dismissToast,
    showToast,
    enableNotifications
  } = useNotifications();
  const pwaUpdate = usePwaUpdate();
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState({});
  const [sessionsByProject, setSessionsByProject] = useState({});
  const [loadingProjectId, setLoadingProjectId] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagePage, setMessagePage] = useState(() => emptyMessagePage());
  const [sessionLoadingId, setSessionLoadingId] = useState(null);
  const [sessionLoadError, setSessionLoadError] = useState('');
  const [activityClockNow, setActivityClockNow] = useState(() => Date.now());
  const [completedSessionIds, setCompletedSessionIds] = useState({});
  const [uploading, setUploading] = useState(false);
  const [permissionMode, setPermissionMode] = useState(() => readStoredPermissionMode());
  const [selectedModel, setSelectedModel] = useState(DEFAULT_STATUS.model);
  const [selectedModelSpeed, setSelectedModelSpeed] = useState(() => normalizeModelSpeed(localStorage.getItem(MODEL_SPEED_KEY)));
  const [gitQuickDialog, setGitQuickDialog] = useState(null);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState(() => {
    const defaultVersion = localStorage.getItem('codexmobile.reasoningDefaultVersion');
    if (defaultVersion !== REASONING_DEFAULT_VERSION) {
      localStorage.setItem('codexmobile.reasoningDefaultVersion', REASONING_DEFAULT_VERSION);
      localStorage.setItem('codexmobile.reasoningEffort', DEFAULT_REASONING_EFFORT);
      return DEFAULT_REASONING_EFFORT;
    }
    return localStorage.getItem('codexmobile.reasoningEffort') || DEFAULT_REASONING_EFFORT;
  });
  const [composerDraftsByKey, setComposerDraftsByKey] = useState({});
  const [runningById, setRunningById] = useState({});
  const [threadRuntimeById, setThreadRuntimeById] = useState({});
  const [submittingBySessionKey, setSubmittingBySessionKey] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [desktopHandoffPending, setDesktopHandoffPending] = useState(false);
  const [homeExiting, setHomeExiting] = useState(false);
  const [connectionState, setConnectionState] = useState(() => (getToken() ? 'connecting' : 'disconnected'));
  const wsRef = useRef(null);
  const selectedProjectRef = useRef(null);
  const selectedSessionRef = useRef(null);
  const messagesRef = useRef([]);
  const autoTitleSyncRef = useRef(new Set());
  const runningByIdRef = useRef({});
  const threadRuntimeByIdRef = useRef({});
  const turnRefreshTimersRef = useRef(new Map());
  const homeWasVisibleRef = useRef(false);
  const lastStatusSettingsRef = useRef({
    model: DEFAULT_STATUS.model,
    reasoningEffort: DEFAULT_STATUS.reasoningEffort || DEFAULT_REASONING_EFFORT
  });
  const selectedModelRef = useRef(selectedModel);
  const selectedReasoningEffortRef = useRef(selectedReasoningEffort);
  const modelSettingsRequestRef = useRef(0);
  const modelSettingsSyncQueueRef = useRef(Promise.resolve());
  const sessionLivePollRef = useRef(false);
  const bootstrapStartedRef = useRef(false);
  const desktopDrawerSeededRef = useRef(false);
  const composerRef = useRef(null);
  const gitQuickDialogResolverRef = useRef(null);
  const attachmentWriteVersionRef = useRef({});
  const selectedRuntimeDisplayRef = useRef(null);

  const handleAuthRevoked = useCallback(() => {
    clearToken();
    setAuthenticated(false);
    setConnectionState('disconnected');
    showToast({
      level: 'warning',
      title: '设备已退出',
      body: '当前设备认证已失效，需要重新配对。'
    });
  }, [showToast]);

  const closeGitQuickDialog = useCallback((value = null) => {
    const resolver = gitQuickDialogResolverRef.current;
    gitQuickDialogResolverRef.current = null;
    setGitQuickDialog(null);
    resolver?.(value);
  }, []);

  const requestGitQuickDialog = useCallback((dialog) => new Promise((resolve) => {
    gitQuickDialogResolverRef.current?.(null);
    gitQuickDialogResolverRef.current = resolve;
    setGitQuickDialog({ ...dialog, busy: false });
  }), []);

  const requestGitInput = useCallback(
    (dialog) => requestGitQuickDialog({ ...dialog, mode: 'input' }),
    [requestGitQuickDialog]
  );
  const requestGitConfirm = useCallback(
    (dialog) => requestGitQuickDialog({ ...dialog, mode: 'confirm' }),
    [requestGitQuickDialog]
  );

  const composerDraftKey = useMemo(
    () => composerDraftKeyForSelection(selectedSession, selectedProject),
    [selectedProject, selectedSession]
  );
  const composerDraft = composerDraftsByKey[composerDraftKey] || EMPTY_COMPOSER_DRAFT;
  const input = composerDraft.input;
  const attachments = composerDraft.attachments;
  const fileMentions = composerDraft.fileMentions;
  const selectedCollaborationMode = composerDraft.collaborationMode;
  const selectedSkillPaths = composerDraft.selectedSkillPaths;

  const updateComposerDraftForKey = useCallback((key, updater) => {
    if (!key) {
      return;
    }
    setComposerDraftsByKey((current) => {
      const previousDraft = normalizeComposerDraft(current[key]);
      const nextDraft = normalizeComposerDraft(resolveStateUpdate(updater, previousDraft));
      if (
        nextDraft.input === previousDraft.input &&
        nextDraft.attachments === previousDraft.attachments &&
        nextDraft.fileMentions === previousDraft.fileMentions &&
        nextDraft.collaborationMode === previousDraft.collaborationMode
      ) {
        return current;
      }
      return { ...current, [key]: nextDraft };
    });
  }, []);

  const setInput = useCallback((nextValue) => {
    updateComposerDraftForKey(composerDraftKey, (current) => ({
      ...current,
      input: String(resolveStateUpdate(nextValue, current.input) || '')
    }));
  }, [composerDraftKey, updateComposerDraftForKey]);

  const setInputForDraftKey = useCallback((draftKey, nextValue) => {
    updateComposerDraftForKey(draftKey, (current) => ({
      ...current,
      input: String(resolveStateUpdate(nextValue, current.input) || '')
    }));
  }, [updateComposerDraftForKey]);

  const setAttachments = useCallback((nextValue) => {
    updateComposerDraftForKey(composerDraftKey, (current) => {
      const resolved = resolveStateUpdate(nextValue, current.attachments);
      return {
        ...current,
        attachments: Array.isArray(resolved) ? resolved : []
      };
    });
  }, [composerDraftKey, updateComposerDraftForKey]);

  const setAttachmentsForDraftKey = useCallback((draftKey, nextValue) => {
    updateComposerDraftForKey(draftKey, (current) => {
      const resolved = resolveStateUpdate(nextValue, current.attachments);
      return {
        ...current,
        attachments: Array.isArray(resolved) ? resolved : []
      };
    });
  }, [updateComposerDraftForKey]);

  const appendAttachmentToDraftKey = useCallback((draftKey, attachment) => {
    updateComposerDraftForKey(draftKey, (current) => ({
      ...current,
      attachments: [...current.attachments, attachment]
    }));
  }, [updateComposerDraftForKey]);

  const setFileMentions = useCallback((nextValue) => {
    updateComposerDraftForKey(composerDraftKey, (current) => {
      const resolved = resolveStateUpdate(nextValue, current.fileMentions);
      return {
        ...current,
        fileMentions: Array.isArray(resolved) ? resolved : []
      };
    });
  }, [composerDraftKey, updateComposerDraftForKey]);

  const setFileMentionsForDraftKey = useCallback((draftKey, nextValue) => {
    updateComposerDraftForKey(draftKey, (current) => {
      const resolved = resolveStateUpdate(nextValue, current.fileMentions);
      return {
        ...current,
        fileMentions: Array.isArray(resolved) ? resolved : []
      };
    });
  }, [updateComposerDraftForKey]);

  const setSelectedCollaborationMode = useCallback((nextValue) => {
    updateComposerDraftForKey(composerDraftKey, (current) => ({
      ...current,
      collaborationMode: resolveStateUpdate(nextValue, current.collaborationMode) === 'plan' ? 'plan' : null
    }));
  }, [composerDraftKey, updateComposerDraftForKey]);

  const setSelectedSkillPaths = useCallback((nextValue) => {
    updateComposerDraftForKey(composerDraftKey, (current) => {
      const resolved = resolveStateUpdate(nextValue, current.selectedSkillPaths);
      return {
        ...current,
        selectedSkillPaths: Array.isArray(resolved) ? resolved.filter(Boolean) : []
      };
    });
  }, [composerDraftKey, updateComposerDraftForKey]);

  const invalidateAttachmentWrites = useCallback((key = composerDraftKey) => {
    if (!key) {
      return;
    }
    attachmentWriteVersionRef.current[key] = (attachmentWriteVersionRef.current[key] || 0) + 1;
  }, [composerDraftKey]);

  const getAttachmentWriteTarget = useCallback((key = composerDraftKey) => ({
    key,
    version: attachmentWriteVersionRef.current[key] || 0
  }), [composerDraftKey]);

  const isAttachmentWriteTargetCurrent = useCallback((target) => {
    const key = String(target?.key || '').trim();
    if (!key) {
      return false;
    }
    return (attachmentWriteVersionRef.current[key] || 0) === Number(target.version || 0);
  }, []);

  const moveComposerDraftState = useCallback((fromKey, toKey) => {
    const sourceKey = String(fromKey || '').trim();
    const targetKey = String(toKey || '').trim();
    if (!sourceKey || !targetKey || sourceKey === targetKey) {
      return;
    }
    setComposerDraftsByKey((current) => {
      if (!current[sourceKey]) {
        return current;
      }
      return {
        ...current,
        [targetKey]: normalizeComposerDraft(current[sourceKey]),
        [sourceKey]: EMPTY_COMPOSER_DRAFT
      };
    });
    const currentVersion = attachmentWriteVersionRef.current[sourceKey];
    if (Number.isFinite(currentVersion)) {
      attachmentWriteVersionRef.current[targetKey] = currentVersion;
    }
    attachmentWriteVersionRef.current[sourceKey] = (attachmentWriteVersionRef.current[sourceKey] || 0) + 1;
    setSubmittingBySessionKey((current) => {
      if (!current[sourceKey] || current[targetKey]) {
        return current;
      }
      const next = { ...current, [targetKey]: current[sourceKey] };
      delete next[sourceKey];
      return next;
    });
  }, []);

  const {
    toggleSelectedSkill,
    selectSkill,
    clearSelectedSkills,
    addFileMention,
    removeFileMention
  } = useComposerSelections(status, {
    fileMentions,
    setFileMentions,
    selectedSkillPaths,
    setSelectedSkillPaths
  });

  const {
    queueDrafts,
    loadQueueDrafts,
    removeQueueDraft,
    restoreQueueDraft,
    steerQueueDraft
  } = useQueueDrafts({
    selectedSessionRef,
    selectedProjectRef,
    selectedProject,
    setInput,
    setAttachments,
    setFileMentions,
    setSelectedSkillPaths,
    setSelectedCollaborationMode,
    invalidateAttachmentWrites
  });

  useViewportSizing(composerRef, { lockWindowScroll: authenticated });

  const activePermissionMode = useMemo(
    () => normalizePermissionModeForSecurity(permissionMode, status.security),
    [permissionMode, status.security]
  );

  const handleSelectPermission = useCallback((value) => {
    setPermissionMode(writeStoredPermissionMode(value));
  }, []);

  useEffect(() => {
    if (!authenticated || desktopDrawerSeededRef.current || typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    desktopDrawerSeededRef.current = true;
    if (window.matchMedia(DESKTOP_SHELL_MEDIA).matches) {
      setDrawerOpen(true);
    }
  }, [authenticated, setDrawerOpen]);

  const syncRunningById = useMemo(() => syncRunningByIdFromRuntime(threadRuntimeById), [threadRuntimeById]);
  const selectedRuntime = selectRuntimeForSession(selectedSession, threadRuntimeById);
  const selectedRuntimeStatus = String(selectedRuntime?.status || '').toLowerCase();
  const selectedSessionArchived = Boolean(selectedSession?.archived);
  const selectedSubmitting = sessionRunKeys(selectedSession).some((key) => Boolean(submittingBySessionKey[key]));
  const hasActiveTurnActivity = selectedMessagesHaveActiveTurnActivity(messages);
  const running =
    hasRunningKey(syncRunningById, selectedRunKeys(selectedSession)) ||
    selectedRuntime?.status === 'running' ||
    selectedRuntime?.status === 'queued';
  const selectedRunning = selectedSessionIsRunning({ running, hasActiveTurnActivity });
  const drawerRunningById = syncRunningById;
  useEffect(() => {
    loadQueueDrafts(selectedSession).catch(() => null);
  }, [selectedSession?.id]);

  useEffect(() => {
    if (!selectedSessionArchived) {
      return;
    }
    setInput('');
    invalidateAttachmentWrites();
    setAttachments([]);
    setFileMentions([]);
    setSelectedCollaborationMode(null);
  }, [invalidateAttachmentWrites, selectedSession?.id, selectedSessionArchived, setFileMentions, setSelectedCollaborationMode, setInput]);

  useEffect(() => {
    setThreadRuntimeById((current) => {
      const next = reconcileThreadRuntimeWithSessions(current, sessionsByProject);
      return next === current ? current : next;
    });
  }, [sessionsByProject]);

  useEffect(() => {
    if (!selectedRunning) {
      return undefined;
    }
    setActivityClockNow(Date.now());
    const timer = window.setInterval(() => setActivityClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [selectedRunning]);

  const {
    markRun,
    clearRun,
    markSessionCompleteNotice,
    clearSessionCompleteNotice,
    markTurnCompleted,
    scheduleTurnRefresh
  } = useTurnRuntime({
    defaultStatus: DEFAULT_STATUS,
    turnRefreshTimersRef,
    selectedSessionRef,
    messagesRef,
    runningByIdRef,
    setRunningById,
    setThreadRuntimeById,
    setCompletedSessionIds,
    setMessages,
    setContextStatus: setSnapshotContextStatus
  });

  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);

  useEffect(() => {
    selectedSessionRef.current = selectedSession;
  }, [selectedSession]);

  useEffect(() => {
    selectedRuntimeDisplayRef.current = null;
  }, [selectedSession?.id, selectedSession?.turnId]);

  useEffect(() => {
    setLiveContextStatus(emptyContextStatus());
  }, [selectedSession?.id, selectedSession?.turnId]);

  useEffect(() => {
    if (selectedRuntime && ['queued', 'running', 'failed'].includes(selectedRuntimeStatus)) {
      selectedRuntimeDisplayRef.current = selectedRuntime;
      return;
    }
    if (!selectedRunning) {
      selectedRuntimeDisplayRef.current = null;
    }
  }, [selectedRunning, selectedRuntime, selectedRuntimeStatus]);

  useEffect(() => {
    rememberSelectedSession(
      selectedSession?.projectId || selectedProject?.id
        ? { ...selectedSession, projectId: selectedSession?.projectId || selectedProject?.id }
        : selectedSession
    );
  }, [selectedProject?.id, selectedSession?.draft, selectedSession?.id, selectedSession?.projectId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    threadRuntimeByIdRef.current = threadRuntimeById;
  }, [threadRuntimeById]);

  useSessionLivePolling({
    authenticated,
    selectedSession,
    running,
    defaultStatus: DEFAULT_STATUS,
    sessionLivePollRef,
    selectedSessionRef,
    setContextStatus: setSnapshotContextStatus,
    setMessages
  });

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    applyPwaTheme(theme);
    if (theme !== 'system' || typeof window === 'undefined') {
      return undefined;
    }
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) {
      return undefined;
    }
    const syncSystemTheme = () => applyPwaTheme('system');
    if (media.addEventListener) {
      media.addEventListener('change', syncSystemTheme);
    } else {
      media.addListener?.(syncSystemTheme);
    }
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener('change', syncSystemTheme);
      } else {
        media.removeListener?.(syncSystemTheme);
      }
    };
  }, [theme]);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    rememberFileManagerView(fileManager);
  }, [fileManager.open, fileManager.path]);

  useEffect(() => {
    selectedReasoningEffortRef.current = selectedReasoningEffort;
    if (selectedReasoningEffort) {
      localStorage.setItem('codexmobile.reasoningEffort', selectedReasoningEffort);
    }
  }, [selectedReasoningEffort]);

  useEffect(() => {
    localStorage.setItem(MODEL_SPEED_KEY, normalizeModelSpeed(selectedModelSpeed || DEFAULT_MODEL_SPEED));
  }, [selectedModelSpeed]);

  useEffect(() => {
    const syncedSource = effectiveComposerSettingsSource(status, selectedSession);
    const previous = lastStatusSettingsRef.current;
    const next = nextSyncedComposerSettings({
      currentModel: selectedModel,
      previousStatusModel: previous.model,
      statusModel: syncedSource.model,
      fallbackModel: DEFAULT_STATUS.model,
      currentReasoningEffort: selectedReasoningEffort,
      previousStatusReasoningEffort: previous.reasoningEffort,
      statusReasoningEffort: syncedSource.reasoningEffort,
      fallbackReasoningEffort: DEFAULT_REASONING_EFFORT
    });
    lastStatusSettingsRef.current = {
      model: syncedSource.model || previous.model,
      reasoningEffort: syncedSource.reasoningEffort || previous.reasoningEffort
    };
    if (next.model && next.model !== selectedModel) {
      setSelectedModel(next.model);
    }
    if (next.reasoningEffort && next.reasoningEffort !== selectedReasoningEffort) {
      setSelectedReasoningEffort(next.reasoningEffort);
    }
  }, [selectedModel, selectedReasoningEffort, selectedSession, status]);

  const {
    loadStatus,
    loadSessions,
    loadProjects,
    bootstrap
  } = useAppBootstrap({
    defaultStatus: DEFAULT_STATUS,
    selectedProjectRef,
    selectedSessionRef,
    setStatus,
    setAuthenticated,
    setSelectedSession,
    setMessages,
    setMessagePage,
    setContextStatus: setSnapshotContextStatus,
    setLoadingProjectId,
    setSessionsByProject,
    setProjects,
    setSelectedProject,
    setExpandedProjectIds
  });

  const syncModelSettings = useCallback(async ({ provider, model, reasoningEffort }) => {
    const next = {
      provider: provider || status.provider || DEFAULT_STATUS.provider,
      model: model || selectedModelRef.current || DEFAULT_STATUS.model,
      reasoningEffort: reasoningEffort || selectedReasoningEffortRef.current || DEFAULT_REASONING_EFFORT
    };
    const requestId = modelSettingsRequestRef.current + 1;
    modelSettingsRequestRef.current = requestId;
    setStatus((current) => mergeModelSettingsIntoStatus(current, next));
    const task = modelSettingsSyncQueueRef.current.catch(() => null).then(async () => {
      const data = await apiFetch('/api/model-settings', {
        method: 'POST',
        body: {
          ...next,
          sessionId: selectedSessionRef.current?.id || null
        }
      });
      if (modelSettingsRequestRef.current === requestId && data.settings) {
        setStatus((current) => mergeModelSettingsIntoStatus(current, data.settings));
      }
      if (data.desktopSync?.attempted && !data.desktopSync?.synced) {
        showToast({
          level: 'warning',
          title: '模型已保存',
          body: '桌面端当前线程没有立即接收模型设置，后续会按配置同步。'
        });
      }
    });
    modelSettingsSyncQueueRef.current = task;
    try {
      await task;
    } catch (error) {
      showToast({
        level: 'error',
        title: '模型同步失败',
        body: error.message || '无法同步模型设置。'
      });
      loadStatus().catch(() => null);
    }
  }, [loadStatus, showToast, status.provider]);

  const handleSelectModel = useCallback((selection) => {
    const model = typeof selection === 'string' ? selection : selection?.value;
    if (!model) {
      return;
    }
    setSelectedModel(model);
    selectedModelRef.current = model;
    syncModelSettings({
      provider: typeof selection === 'object' ? selection.provider : null,
      model,
      reasoningEffort: selectedReasoningEffortRef.current
    });
  }, [syncModelSettings]);

  const handleSelectReasoningEffort = useCallback((reasoningEffort) => {
    setSelectedReasoningEffort(reasoningEffort);
    selectedReasoningEffortRef.current = reasoningEffort;
    syncModelSettings({ model: selectedModelRef.current, reasoningEffort });
  }, [syncModelSettings]);

  useEffect(() => {
    if (bootstrapStartedRef.current) {
      return;
    }
    bootstrapStartedRef.current = true;
    bootstrap();
  }, [bootstrap]);

  const {
    handleToggleProject,
    handleSelectSession,
    handleLoadOlderMessages,
    handleRenameSession,
    handleDeleteSession,
    handleDeleteMessage,
    handleNewConversation
  } = useSessionActions({
    defaultStatus: DEFAULT_STATUS,
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
    setContextStatus: setSnapshotContextStatus,
    setAttachments,
    setInput,
    invalidateAttachmentWrites,
    setDrawerOpen,
    loadSessions,
    upsertSessionInProject,
    clearSessionCompleteNotice
  });

  useAppWebSocket({
    useEffect,
    authenticated: authenticated && Boolean(status.auth?.authenticated),
    defaultStatus: DEFAULT_STATUS,
    wsRef,
    selectedProjectRef,
    selectedSessionRef,
    setConnectionState,
    setStatus,
    markRun,
    clearRun,
    markSessionCompleteNotice,
    markTurnCompleted,
    scheduleTurnRefresh,
    upsertSessionInProject,
    setRunningById,
    runningByIdRef,
    threadRuntimeByIdRef,
    setThreadRuntimeById,
    setSelectedSession,
    setSessionsByProject,
    setMessages,
    setContextStatus: setSnapshotContextStatus,
    setLiveContextStatus,
    setProjects,
    setSelectedProject,
    setExpandedProjectIds,
    loadSessions,
    loadQueueDrafts,
    moveComposerDraftState,
    onAuthRevoked: handleAuthRevoked
  });

  const {
    handleSync,
    handleRetryConnection,
    handleResetPairing,
    handleShowConnectionStatus
  } = useConnectionActions({
    apiFetch,
    status,
    connectionState,
    setAuthenticated,
    setConnectionState,
    setSyncing,
    loadStatus,
    loadProjects,
    showToast
  });

  const {
    handleUploadFiles,
    handleRemoveAttachment
  } = useFileUploads({
    setUploading,
    appendAttachmentToDraftKey,
    setMessages,
    getAttachmentWriteTarget,
    isAttachmentWriteTargetCurrent
  });

  const {
    handleSubmit,
    handleImplementPlan,
    handleAdjustPlan,
    handleAbort
  } = useTurnSubmission({
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    selectedProject,
    selectedProjectRef,
    selectedSession,
    selectedSessionRef,
    projects,
    selectedSkillPaths,
    status,
    permissionMode: activePermissionMode,
    selectedModel,
    selectedModelSpeed,
    selectedReasoningEffort,
    input,
    attachments,
    fileMentions,
    runningById: syncRunningById,
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
  });

  async function createGitBranchFromDialog(project = selectedProject) {
    if (!project?.id) return null;
    const branchName = await requestGitInput({
      kind: 'branch',
      title: '创建分支',
      label: '分支名',
      defaultValue: gitBranchDraft(project),
      confirmText: '创建'
    });
    if (!branchName?.trim()) return null;
    showToast({ level: 'info', title: '创建分支', body: '正在创建并切换分支...' });
    const result = await apiFetch('/api/git/branch', {
      method: 'POST',
      body: { projectId: project.id, branchName: branchName.trim() }
    });
    showToast({ level: 'success', title: '创建分支', body: `已切换到 ${result.branch || branchName.trim()}` });
    return result;
  }

  async function handleGitAction(action) {
    if (!selectedProject || selectedRunning) {
      return;
    }
    const projectId = selectedProject.id;
    try {
      if (action === 'branch') {
        await createGitBranchFromDialog(selectedProject);
        return;
      }

      if (action === 'commit') {
        const data = await apiFetch(`/api/git/status?projectId=${encodeURIComponent(projectId)}`);
        const gitStatus = data.status || {};
        if (!gitStatus.canCommit) {
          showToast({ level: 'warning', title: '提交', body: '没有可提交的改动。' });
          return;
        }
        const count = gitChangedFileCount(gitStatus);
        if (gitNeedsExplicitConfirm(gitStatus)) {
          const ok = await requestGitConfirm({
            kind: 'commit',
            title: '确认提交',
            message: `当前在 ${gitStatus.branch || '未知分支'}，工作区有 ${count} 个改动文件。确认提交整个工作区吗？`,
            confirmText: '确认提交'
          });
          if (!ok) return;
        }
        const message = await requestGitInput({
          kind: 'commit',
          title: '提交',
          label: '提交信息',
          defaultValue: gitStatus.defaultCommitMessage || '更新项目',
          confirmText: '提交'
        });
        if (!message?.trim()) return;
        showToast({ level: 'info', title: '提交', body: '正在提交 Git 改动...' });
        const result = await apiFetch('/api/git/commit', {
          method: 'POST',
          timeoutMs: 70_000,
          body: { projectId, message: message.trim() }
        });
        showToast({ level: 'success', title: '提交', body: result.hash ? `已提交 ${result.hash}` : 'Git 提交已完成。' });
        return;
      }

      if (action === 'push') {
        const data = await apiFetch(`/api/git/status?projectId=${encodeURIComponent(projectId)}`);
        const gitStatus = data.status || {};
        if (!gitStatus.branch) {
          showToast({ level: 'warning', title: '推送', body: '当前不在有效 Git 分支上。' });
          return;
        }
        if (gitStatus.branch === 'main' || gitStatus.branch === 'master') {
          const ok = await requestGitConfirm({
            kind: 'push',
            title: '确认推送',
            message: `当前分支是 ${gitStatus.branch}，确认推送吗？`,
            confirmText: '确认推送'
          });
          if (!ok) return;
        }
        showToast({ level: 'info', title: '推送', body: '正在推送当前分支...' });
        const result = await apiFetch('/api/git/push', {
          method: 'POST',
          timeoutMs: 130_000,
          body: { projectId }
        });
        showToast({ level: 'success', title: '推送', body: result.branch ? `已推送 ${result.branch}` : 'Git 推送已完成。' });
      }
    } catch (error) {
      const title = action === 'branch' ? '创建分支' : action === 'push' ? '推送' : '提交';
      showToast({ level: 'error', title, body: error.message || 'Git 操作失败。' });
    }
  }

  const {
    handleConnectDocs,
    handleDisconnectDocs,
    handleRefreshDocs,
    handleOpenDocsHome,
    handleOpenDocsAuth
  } = useDocsActions({
    docsBusy,
    status,
    setStatus,
    setDocsBusy,
    setDocsError,
    loadStatus
  });

  const sessionLoading = Boolean(sessionLoadingId && selectedSession?.id === sessionLoadingId);
  const homeVisible = !sessionLoading && !sessionLoadError && messages.length === 0 && (!selectedSession || isDraftSession(selectedSession));
  const homePaneVisible = homeVisible || homeExiting;
  const composerGitProject = useMemo(
    () => resolveComposerGitProject({ homeVisible, projects, selectedProject, selectedSession }),
    [homeVisible, projects, selectedProject, selectedSession]
  );
  const shellClass = useMemo(() => {
    const classes = ['app-shell'];
    if (drawerOpen) {
      classes.push('drawer-active');
    }
    if (homeVisible) {
      classes.push('is-home');
    }
    if (homeExiting) {
      classes.push('is-home-exiting');
    }
    return classes.join(' ');
  }, [drawerOpen, homeExiting, homeVisible]);

  useEffect(() => {
    if (homeVisible) {
      homeWasVisibleRef.current = true;
      setHomeExiting(false);
      return undefined;
    }
    if (!homeWasVisibleRef.current) {
      return undefined;
    }
    homeWasVisibleRef.current = false;
    setHomeExiting(true);
    const timer = window.setTimeout(() => setHomeExiting(false), 280);
    return () => window.clearTimeout(timer);
  }, [homeVisible]);
  const visibleContextStatus = useMemo(
    () => {
      if (!selectedSession || isDraftSession(selectedSession)) {
        return emptyContextStatus();
      }
      const snapshot = normalizeContextStatus(
        snapshotContextStatus || selectedSession.context || DEFAULT_STATUS.context,
        DEFAULT_STATUS.context
      );
      if (!selectedRunning) {
        return snapshot;
      }
      return mergeContextStatus(snapshot, liveContextStatus, DEFAULT_STATUS.context);
    },
    [liveContextStatus, selectedRunning, selectedSession, snapshotContextStatus]
  );
  const recoveryState = connectionRecoveryState({
    authenticated,
    connectionState,
    desktopBridge: status.desktopBridge,
    syncing
  });
  const displayRuntime =
    selectedRuntime ||
    (selectedRunning ? selectedRuntimeDisplayRef.current || GENERIC_RUNNING_RUNTIME : null);
  const handleToggleDrawer = useCallback(() => {
    const desktopShell = typeof window !== 'undefined' && window.matchMedia?.(DESKTOP_SHELL_MEDIA)?.matches;
    setDrawerOpen((current) => (desktopShell ? !current : true));
  }, [setDrawerOpen]);
  const handleOpenDocs = useCallback(() => setDocsOpen(true), [setDocsOpen]);
  const handleCloseDocs = useCallback(() => setDocsOpen(false), [setDocsOpen]);
  const handleCloseFileManager = useCallback(() => dispatchFileManager({ type: 'close' }), []);
  const handleCloseGitPanel = useCallback(() => setGitPanel((current) => ({ ...current, open: false })), [setGitPanel]);
  const handleClosePreviewImage = useCallback(() => setPreviewImage(null), [setPreviewImage]);
  const handleOpenFileManager = useCallback(() => {
    dispatchFileManager({ type: 'open', path: selectedProject?.path || '' });
    setDrawerOpen(false);
  }, [selectedProject?.path, setDrawerOpen]);
  const handleSelectModelSpeed = useCallback((value) => {
    setSelectedModelSpeed(normalizeModelSpeed(value));
  }, []);
  const handleCreateGitBranch = useCallback(() => createGitBranchFromDialog(composerGitProject), [composerGitProject]);

  const handleComposerSubmit = useCallback(async (options = {}) => {
    if ((selectedSessionRef.current || selectedSession)?.archived) {
      return;
    }
    const collaborationMode = options.collaborationMode || selectedCollaborationMode || null;
    const result = await handleSubmit({ ...options, collaborationMode });
    if (result && collaborationMode) {
      setSelectedCollaborationMode(null);
    }
    if (result && typeof result === 'object') {
      const deliveryMode = String(result.deliveryMode || '').trim();
      const refreshResult = String(result.desktopRefreshResult || '').trim();
      const reason = String(result.reason || '').trim();
      if (deliveryMode === 'desktop-ipc') {
        showToast({
          level: 'success',
          title: '已发送到桌面端',
          body: reason || '当前消息已交给桌面端打开的线程。'
        });
      } else if (deliveryMode === 'headless') {
        const level = refreshResult === 'failed' ? 'warning' : 'info';
        showToast({
          level,
          title: '已通过后台 Codex 执行',
          body: reason || '桌面端可能不会立刻显示，需要等待刷新或手动打开该会话。'
        });
      }
    }
  }, [handleSubmit, selectedCollaborationMode, selectedSession, setSelectedCollaborationMode]);

  const handleCompactContext = useCallback(async () => {
    const project = selectedProjectRef.current || selectedProject;
    const session = selectedSessionRef.current || selectedSession;
    if (!project?.id || !session?.id || isDraftSession(session)) {
      showToast({
        level: 'warning',
        title: '无法压缩上下文',
        body: '请先打开一个已有线程。'
      });
      return false;
    }
    const actionId = globalThis.crypto?.randomUUID?.() || `manual-context-compaction-${Date.now()}`;
    const startedAt = new Date().toISOString();
    setMessages((current) => upsertActivityMessage(current, {
      projectId: project.id,
      sessionId: session.id,
      messageId: actionId,
      kind: 'context_compaction',
      status: 'running',
      label: '正在压缩上下文',
      startedAt,
      timestamp: startedAt
    }));
    showToast({
      level: 'info',
      title: '正在压缩上下文',
      body: '移动端会同步显示压缩进度。'
    });
    try {
      await apiFetch('/api/chat/compact', {
        method: 'POST',
        timeoutMs: 35_000,
        body: {
          projectId: project.id,
          sessionId: session.id,
          clientActionId: actionId
        }
      });
      const timestamp = new Date().toISOString();
      setMessages((current) => upsertActivityMessage(current, {
        projectId: project.id,
        sessionId: session.id,
        messageId: actionId,
        kind: 'context_compaction',
        status: 'completed',
        label: '上下文已压缩',
        startedAt,
        completedAt: timestamp,
        timestamp
      }));
      setSnapshotContextStatus((current) => mergeContextStatus(current, {
        autoCompact: {
          detected: true,
          status: 'detected',
          lastCompactedAt: timestamp,
          reason: '手动压缩上下文'
        },
        updatedAt: timestamp
      }, DEFAULT_STATUS.context));
      showToast({
        level: 'success',
        title: '上下文已压缩',
        body: '当前线程的压缩结果已同步。'
      });
      return true;
    } catch (error) {
      const failedAt = new Date().toISOString();
      setMessages((current) => upsertActivityMessage(current, {
        projectId: project.id,
        sessionId: session.id,
        messageId: actionId,
        kind: 'context_compaction',
        status: 'failed',
        label: '上下文压缩失败',
        detail: error.message || '桌面端没有完成上下文压缩。',
        startedAt,
        completedAt: failedAt,
        timestamp: failedAt
      }));
      showToast({
        level: 'error',
        title: '压缩失败',
        body: error.message || '桌面端没有完成上下文压缩。'
      });
      return false;
    }
  }, [selectedProject, selectedSession, showToast]);

  const handleDesktopHandoff = useCallback(async () => {
    const session = selectedSessionRef.current || selectedSession;
    if (!session?.id || isDraftSession(session)) {
      showToast({
        level: 'warning',
        title: '暂时不能回到桌面',
        body: '请先打开一个已创建的对话。'
      });
      return false;
    }
    if (selectedRunning) {
      showToast({
        level: 'warning',
        title: '执行完成后再回到桌面',
        body: '当前对话还在执行中，完成后再打开桌面端更安全。'
      });
      return false;
    }
    setDesktopHandoffPending(true);
    try {
      await apiFetch('/api/desktop-handoff', {
        method: 'POST',
        timeoutMs: 12_000,
        body: { sessionId: session.id }
      });
      showToast({
        level: 'success',
        title: '已重启桌面端',
        body: 'Codex 桌面端会重新进入当前对话。'
      });
      return true;
    } catch (error) {
      showToast({
        level: 'error',
        title: '桌面端打开失败',
        body: error.message || '请确认 Mac 上已安装并可打开 Codex.app。'
      });
      return false;
    } finally {
      setDesktopHandoffPending(false);
    }
  }, [selectedSession, selectedRunning, showToast]);

  if (!authenticated) {
    return <PairingScreen pairing={status.pairing} authCanPair={status.auth?.canPair !== false} onPaired={bootstrap} onServerChanged={bootstrap} />;
  }

  const panelProps = useMemo(() => ({
    topBarProps: {
      selectedProject,
      selectedSession,
      connectionState,
      desktopBridge: status.desktopBridge,
      selectedRuntime: displayRuntime,
      onMenu: handleToggleDrawer,
      onOpenDocs: handleOpenDocs,
      onGitAction: handleGitAction,
      onDesktopHandoff: handleDesktopHandoff,
      desktopHandoffSupported: status.desktopRefresh?.supported !== false,
      desktopHandoffPending,
      notificationSupported,
      notificationEnabled,
      onEnableNotifications: enableNotifications,
      gitDisabled: !selectedProject || selectedRunning,
      homeMode: homePaneVisible
    },
    docsPanelProps: {
      open: docsOpen,
      docs: status.docs,
      busy: docsBusy,
      error: docsError,
      onClose: handleCloseDocs,
      onConnect: handleConnectDocs,
      onDisconnect: handleDisconnectDocs,
      onOpenHome: handleOpenDocsHome,
      onOpenAuth: handleOpenDocsAuth,
      onRefresh: handleRefreshDocs
    },
    fileManagerPanelProps: {
      open: fileManager.open,
      state: fileManager,
      dispatch: dispatchFileManager,
      projects,
      selectedProject,
      onClose: handleCloseFileManager
    },
    gitPanelProps: {
      open: gitPanel.open,
      action: gitPanel.action,
      project: selectedProject,
      onToast: showToast,
      onClose: handleCloseGitPanel
    },
    gitQuickDialogProps: {
      dialog: gitQuickDialog,
      onCancel: () => closeGitQuickDialog(null),
      onSubmit: closeGitQuickDialog
    },
    recoveryCardProps: {
      state: recoveryState,
      onRetry: handleRetryConnection,
      onSync: handleSync,
      onPair: handleResetPairing,
      onStatus: handleShowConnectionStatus
    },
    toastStackProps: {
      toasts,
      onDismiss: dismissToast
    },
    pwaUpdateProps: {
      available: pwaUpdate.available,
      onRefresh: pwaUpdate.refresh,
      onDismiss: pwaUpdate.dismiss
    },
    imagePreviewProps: {
      image: previewImage,
      onClose: handleClosePreviewImage
    }
  }), [
    connectionState,
    desktopHandoffPending,
    dismissToast,
    displayRuntime,
    docsBusy,
    docsError,
    docsOpen,
    enableNotifications,
    fileManager,
    gitPanel.action,
    gitPanel.open,
    gitQuickDialog,
    handleCloseDocs,
    handleCloseFileManager,
    handleCloseGitPanel,
    handleClosePreviewImage,
    handleConnectDocs,
    handleDesktopHandoff,
    handleDisconnectDocs,
    handleGitAction,
    handleOpenDocs,
    handleOpenDocsAuth,
    handleOpenDocsHome,
    handleRefreshDocs,
    handleResetPairing,
    handleRetryConnection,
    handleShowConnectionStatus,
    handleSync,
    handleToggleDrawer,
    notificationEnabled,
    notificationSupported,
    previewImage,
    projects,
    pwaUpdate.available,
    pwaUpdate.dismiss,
    pwaUpdate.refresh,
    recoveryState,
    selectedProject,
    selectedRunning,
    selectedSession,
    showToast,
    status.desktopBridge,
    status.desktopRefresh?.supported,
    status.docs,
    toasts
  ]);
  const drawerProps = useMemo(() => ({
    open: drawerOpen,
    onClose: () => setDrawerOpen(false),
    projects,
    selectedProject,
    selectedSession,
    expandedProjectIds,
    sessionsByProject,
    loadingProjectId,
    runningById: drawerRunningById,
    threadRuntimeById,
    completedSessionIds,
    onToggleProject: handleToggleProject,
    onSelectSession: handleSelectSession,
    onRenameSession: handleRenameSession,
    onDeleteSession: handleDeleteSession,
    onNewConversation: handleNewConversation,
    onSync: handleSync,
    syncing,
    onOpenFileManager: () => {
      dispatchFileManager({ type: 'open', path: selectedProject?.path || '' });
      setDrawerOpen(false);
    },
    theme,
    setTheme,
    runtimeDebug: status.runtimeDebug,
    desktopRefresh: status.desktopRefresh,
    security: status.security,
    onLoggedOut: handleAuthRevoked,
    refreshStatus: loadStatus
  }), [
    completedSessionIds,
    drawerOpen,
    drawerRunningById,
    expandedProjectIds,
    handleAuthRevoked,
    handleDeleteSession,
    handleNewConversation,
    handleRenameSession,
    handleSelectSession,
    handleSync,
    handleToggleProject,
    loadStatus,
    loadingProjectId,
    projects,
    selectedProject,
    selectedSession,
    sessionsByProject,
    setTheme,
    status.desktopRefresh,
    status.runtimeDebug,
    status.security,
    syncing,
    theme,
    threadRuntimeById
  ]);
  const chatProps = useMemo(() => ({
    messages,
    selectedSession,
    loading: sessionLoading,
    loadError: sessionLoadError,
    running: selectedRunning,
    submitting: selectedSubmitting,
    activeRuntimeStartedAt: selectedRuntime?.startedAt || selectedRuntime?.updatedAt || null,
    now: activityClockNow,
    hasMoreBefore: messagePage.hasMoreBefore,
    loadingOlder: messagePage.loadingOlder,
    onLoadOlderMessages: handleLoadOlderMessages,
    onPreviewImage: setPreviewImage,
    onDeleteMessage: handleDeleteMessage,
    onImplementPlan: selectedSessionArchived ? null : handleImplementPlan,
    onAdjustPlan: selectedSessionArchived ? null : handleAdjustPlan
  }), [
    activityClockNow,
    handleAdjustPlan,
    handleDeleteMessage,
    handleImplementPlan,
    handleLoadOlderMessages,
    messagePage.hasMoreBefore,
    messagePage.loadingOlder,
    messages,
    selectedRuntime?.startedAt,
    selectedRuntime?.updatedAt,
    selectedSession,
    selectedSessionArchived,
    selectedSubmitting,
    selectedRunning,
    sessionLoadError,
    sessionLoading,
    setPreviewImage
  ]);
  const composerProps = useMemo(() => ({
    composerRef,
    input,
    setInput,
    selectedProject,
    gitProject: composerGitProject,
    selectedSession,
    onSubmit: handleComposerSubmit,
    running: selectedRunning,
    submitting: selectedSubmitting,
    onAbort: handleAbort,
    models: status.models,
    selectedModel,
    onSelectModel: handleSelectModel,
    selectedModelSpeed,
    onSelectModelSpeed: handleSelectModelSpeed,
    selectedReasoningEffort,
    onSelectReasoningEffort: handleSelectReasoningEffort,
    selectedCollaborationMode,
    onSelectCollaborationMode: setSelectedCollaborationMode,
    skills: status.skills,
    selectedSkillPaths,
    onToggleSkill: toggleSelectedSkill,
    onSelectSkill: selectSkill,
    onClearSkills: clearSelectedSkills,
    permissionMode: activePermissionMode,
    onSelectPermission: handleSelectPermission,
    security: status.security,
    attachments,
    onUploadFiles: handleUploadFiles,
    onRemoveAttachment: handleRemoveAttachment,
    fileMentions,
    onAddFileMention: addFileMention,
    onRemoveFileMention: removeFileMention,
    uploading,
    contextStatus: visibleContextStatus,
    runSteerable: displayRuntime?.steerable !== false,
    desktopBridge: status.desktopBridge,
    queueDrafts,
    onRestoreQueueDraft: restoreQueueDraft,
    onRemoveQueueDraft: removeQueueDraft,
    onSteerQueueDraft: steerQueueDraft,
    onCreateGitBranch: handleCreateGitBranch,
    onCompactContext: handleCompactContext,
    readOnly: selectedSessionArchived,
    readOnlyReason: '已归档线程只能查看，取消归档后才能继续对话',
    homeMode: homeVisible,
    projects,
    onSelectHomeProject: handleNewConversation
  }), [
    activePermissionMode,
    addFileMention,
    attachments,
    clearSelectedSkills,
    composerGitProject,
    composerRef,
    displayRuntime?.steerable,
    fileMentions,
    handleAbort,
    handleCompactContext,
    handleComposerSubmit,
    handleCreateGitBranch,
    handleNewConversation,
    handleRemoveAttachment,
    handleSelectModel,
    handleSelectModelSpeed,
    handleSelectPermission,
    handleSelectReasoningEffort,
    handleUploadFiles,
    homeVisible,
    input,
    loadingProjectId,
    permissionMode,
    projects,
    queueDrafts,
    removeFileMention,
    removeQueueDraft,
    restoreQueueDraft,
    selectedCollaborationMode,
    selectedModel,
    selectedModelSpeed,
    selectedProject,
    selectedReasoningEffort,
    selectedRunning,
    selectedSession,
    selectedSessionArchived,
    selectedSkillPaths,
    selectedSubmitting,
    selectSkill,
    setInput,
    setSelectedCollaborationMode,
    status.desktopBridge,
    status.models,
    status.security,
    status.skills,
    steerQueueDraft,
    toggleSelectedSkill,
    uploading,
    visibleContextStatus
  ]);

  return (
    <AppShell
      shellClass={shellClass}
      panelProps={panelProps}
      drawerProps={drawerProps}
      chatProps={chatProps}
      composerProps={composerProps}
      homeVisible={homePaneVisible}
    />
  );
}
