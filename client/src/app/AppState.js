/**
 * 轻量 UI 状态机：侧栏、预览、文档面板、Git 面板、Toast、主题等纯客户端 reducer 与初始状态。
 *
 * Keywords: ui-state, reducer, theme-preference
 *
 * Exports:
 * - `THEME_KEY` — localStorage 中主题偏好键名。
 * - `createInitialUiState` — 从 storage 读取主题等字段构造初始 state。
 * - `appReducer` — `ui/*` action 分发的 reducer。
 *
 * Inward: `localStorage`（可注入）。
 *
 * Outward: `App.jsx` 与依赖 `THEME_KEY` 的面板/预览组件。
 */

export const THEME_KEY = 'codexmobile.theme';
const THEME_VALUES = new Set(['light', 'dark', 'system']);

function normalizeThemePreference(value) {
  return THEME_VALUES.has(value) ? value : 'light';
}

export function createInitialUiState({ storage = globalThis.localStorage } = {}) {
  return {
    drawerOpen: false,
    previewImage: null,
    docsOpen: false,
    docsBusy: false,
    docsError: '',
    gitPanel: { open: false, action: 'commit' },
    toasts: [],
    theme: normalizeThemePreference(storage?.getItem?.(THEME_KEY))
  };
}

function resolveValue(value, current) {
  return typeof value === 'function' ? value(current) : value;
}

export function appReducer(state, action) {
  switch (action.type) {
    case 'ui/drawerOpen':
      return { ...state, drawerOpen: resolveValue(action.value, state.drawerOpen) };
    case 'ui/previewImage':
      return { ...state, previewImage: resolveValue(action.value, state.previewImage) };
    case 'ui/docsOpen':
      return { ...state, docsOpen: resolveValue(action.value, state.docsOpen) };
    case 'ui/docsBusy':
      return { ...state, docsBusy: resolveValue(action.value, state.docsBusy) };
    case 'ui/docsError':
      return { ...state, docsError: resolveValue(action.value, state.docsError) };
    case 'ui/gitPanel':
      return { ...state, gitPanel: resolveValue(action.value, state.gitPanel) };
    case 'ui/toasts':
      return { ...state, toasts: resolveValue(action.value, state.toasts) };
    case 'ui/theme':
      return { ...state, theme: normalizeThemePreference(resolveValue(action.value, state.theme)) };
    default:
      return state;
  }
}
