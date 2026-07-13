/**
 * 文件管理面板的纯状态工具：打开关闭、目录加载结果归并、条目排序与打开目标判断。
 *
 * Keywords: file-manager, reducer, navigation, sorting, browser
 *
 * Exports:
 * - initialFileManagerState — 面板初始状态。
 * - createInitialFileManagerState — 从 storage 恢复刷新前打开的文件管理路径。
 * - rememberFileManagerView — 持久化/清除文件管理页刷新恢复状态。
 * - sortFileManagerEntries — 目录优先、名称排序的条目排序器。
 * - fileManagerEntryOpenAction — 判断点击条目时应进目录、内嵌预览还是跳转预览页。
 * - fileManagerReducer — 管理打开、加载、失败与路径跳转状态。
 *
 * Inward: 无外部依赖。
 *
 * Outward: AppState 测试、FileManagerPanel 与 App 根状态。
 *
 * 不负责: HTTP 请求与文件预览渲染。
 */

export const initialFileManagerState = {
  open: false,
  path: '',
  parentPath: '',
  entries: [],
  loading: false,
  error: ''
};

export const FILE_MANAGER_VIEW_KEY = 'codexmobile.fileManagerView';

function normalizedPath(value) {
  return String(value || '').trim();
}

function storageOrNull(storage = globalThis.localStorage) {
  return storage && typeof storage.getItem === 'function' ? storage : null;
}

export function createInitialFileManagerState({ storage = globalThis.localStorage } = {}) {
  const source = storageOrNull(storage);
  if (!source) {
    return { ...initialFileManagerState };
  }
  try {
    const stored = JSON.parse(source.getItem(FILE_MANAGER_VIEW_KEY) || '{}');
    if (stored?.open) {
      return {
        ...initialFileManagerState,
        open: true,
        path: normalizedPath(stored.path)
      };
    }
  } catch {
    // Ignore malformed storage and fall back to a closed panel.
  }
  return { ...initialFileManagerState };
}

export function rememberFileManagerView(state = {}, storage = globalThis.localStorage) {
  const target = storage && typeof storage.setItem === 'function' && typeof storage.removeItem === 'function' ? storage : null;
  if (!target) {
    return;
  }
  try {
    if (!state.open) {
      target.removeItem(FILE_MANAGER_VIEW_KEY);
      return;
    }
    target.setItem(FILE_MANAGER_VIEW_KEY, JSON.stringify({
      open: true,
      path: normalizedPath(state.path)
    }));
  } catch {
    // Storage can be unavailable in private/embedded contexts.
  }
}

export function sortFileManagerEntries(entries = []) {
  return [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1;
    }
    return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN', {
      numeric: true,
      sensitivity: 'base'
    });
  });
}

export function fileManagerEntryOpenAction(entry = {}, { desktop = false } = {}) {
  const path = normalizedPath(entry.path);
  if (entry.kind === 'directory') {
    return { type: 'directory', path };
  }
  return {
    type: desktop ? 'preview' : 'navigate',
    path
  };
}

export function fileManagerReducer(state = initialFileManagerState, action = {}) {
  switch (action.type) {
    case 'open':
      return {
        ...state,
        open: true,
        path: normalizedPath(action.path) || state.path,
        error: ''
      };
    case 'close':
      return { ...state, open: false };
    case 'loading':
      return {
        ...state,
        loading: true,
        error: '',
        path: normalizedPath(action.path) || state.path
      };
    case 'loaded':
      return {
        ...state,
        loading: false,
        error: '',
        path: normalizedPath(action.path),
        parentPath: normalizedPath(action.parentPath),
        entries: sortFileManagerEntries(action.entries)
      };
    case 'failed':
      return {
        ...state,
        loading: false,
        error: String(action.error || '目录读取失败')
      };
    default:
      return state;
  }
}
