/**
 * PWA 主题元数据与 DOM 应用：规范化 light/dark/system，写入 `meta theme-color` 与根节点 `data-theme*`。
 *
 * Keywords: pwa-theme, theme-color, prefers-color-scheme
 *
 * Exports:
 * - `PWA_THEME_META` — 亮/暗下浏览器顶栏配色与状态栏样式。
 * - `normalizePwaTheme` / `resolvePwaTheme` — 偏好解析（含 system）。
 * - `applyPwaTheme` — 更新 `document` 与 meta 标签。
 *
 * Inward: 浏览器 `document` / `matchMedia`。
 *
 * Outward: `App.jsx`、`FilePreviewApp` 等于载入时统一视觉与 OEM 顶栏。
 */

export const PWA_THEME_META = {
  light: {
    themeColor: '#ffffff',
    statusBarStyle: 'default'
  },
  dark: {
    themeColor: '#000000',
    statusBarStyle: 'black-translucent'
  }
};

export function normalizePwaTheme(theme) {
  return theme === 'dark' || theme === 'system' ? theme : 'light';
}

export function resolvePwaTheme(theme, win = globalThis.window) {
  const preference = normalizePwaTheme(theme);
  if (preference !== 'system') {
    return preference;
  }
  return win?.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
}

export function applyPwaTheme(theme, doc = globalThis.document) {
  const preference = normalizePwaTheme(theme);
  const resolvedTheme = resolvePwaTheme(preference, doc?.defaultView || globalThis.window);
  const meta = {
    ...PWA_THEME_META[resolvedTheme],
    preference,
    resolvedTheme
  };

  if (!doc) {
    return meta;
  }

  if (doc.documentElement?.dataset) {
    doc.documentElement.dataset.theme = resolvedTheme;
    doc.documentElement.dataset.themePreference = preference;
  }

  doc.querySelector?.('meta[data-app-theme-color]')?.setAttribute?.('content', meta.themeColor);
  doc.querySelector?.('meta[data-app-status-bar-style]')?.setAttribute?.('content', meta.statusBarStyle);

  return meta;
}
