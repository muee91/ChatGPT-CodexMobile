/**
 * 记住用户上次选中的项目与会话：读写 localStorage，并在项目/会话列表加载后解析为首选选中项。
 *
 * Keywords: selection-persistence, localStorage, session-memory
 *
 * Exports:
 * - `SELECTED_PROJECT_KEY` / `SELECTED_SESSION_KEY` — storage 键常量。
 * - `readStoredSelection`、`rememberSelectedSession` — 读写给定 storage。
 * - `preferredProjectFromStoredSelection`、`selectedSessionFromStoredSelection` — 从列表中匹配可恢复项。
 *
 * Inward: `localStorage`（可注入）。
 *
 * Outward: `useAppBootstrap`、`App.jsx` 在切换会话时持久化。
 */

export const SELECTED_PROJECT_KEY = 'codexmobile.selectedProjectId';
export const SELECTED_SESSION_KEY = 'codexmobile.selectedSessionId';

function storageOrNull(storage = globalThis.localStorage) {
  return storage && typeof storage.getItem === 'function' ? storage : null;
}

function storedText(storage, key) {
  try {
    return String(storage?.getItem?.(key) || '').trim();
  } catch {
    return '';
  }
}

function isDraftSessionLike(session) {
  const id = String(session?.id || '');
  return Boolean(session?.draft || id.startsWith('draft-'));
}

export function readStoredSelection(storage = globalThis.localStorage) {
  const source = storageOrNull(storage);
  if (!source) {
    return { projectId: '', sessionId: '' };
  }
  return {
    projectId: storedText(source, SELECTED_PROJECT_KEY),
    sessionId: storedText(source, SELECTED_SESSION_KEY)
  };
}

export function rememberSelectedSession(session, storage = globalThis.localStorage) {
  const target = storageOrNull(storage);
  if (!target || !session?.id || isDraftSessionLike(session)) {
    return;
  }
  try {
    target.setItem(SELECTED_SESSION_KEY, String(session.id));
    if (session.projectId) {
      target.setItem(SELECTED_PROJECT_KEY, String(session.projectId));
    }
  } catch {
    // Storage can be unavailable in private/embedded contexts.
  }
}

export function preferredProjectFromStoredSelection(projects = [], {
  preserveSelection = false,
  currentProject = null,
  storedProjectId = ''
} = {}) {
  if (preserveSelection && currentProject?.id) {
    const current = projects.find((project) => project.id === currentProject.id);
    if (current) {
      return current;
    }
  }
  if (storedProjectId) {
    const stored = projects.find((project) => project.id === storedProjectId);
    if (stored) {
      return stored;
    }
  }
  return (
    projects.find((project) => project.name.toLowerCase() === 'codexmobile') ||
    projects.find((project) => project.path.toLowerCase().includes('codexmobile')) ||
    projects[0] ||
    null
  );
}

export function selectedSessionFromStoredSelection(sessions = [], {
  preserveSelection = false,
  currentSession = null,
  storedSessionId = '',
  chooseLatest = true
} = {}) {
  if (preserveSelection && currentSession?.id) {
    if (isDraftSessionLike(currentSession)) {
      return currentSession;
    }
    const current = sessions.find((session) => session.id === currentSession.id);
    if (current) {
      return current;
    }
  }
  if (storedSessionId) {
    const stored = sessions.find((session) => session.id === storedSessionId);
    if (stored) {
      return stored;
    }
  }
  return chooseLatest ? sessions[0] || null : null;
}
