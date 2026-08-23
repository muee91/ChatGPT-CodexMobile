/**
 * React 应用挂载入口：根路由选择默认 App、文件预览或截图演示子应用。
 *
 * Keywords: entry, React, createRoot, preview-route
 *
 * Exports:
 * - 无 default；顶层执行 createRoot 挂载。
 *
 * Inward: App.jsx、FilePreviewApp、DemoScreenshotApp、全局样式。
 *
 * Outward: Vite HTML 入口 `index.html` 所引脚本。
 */

import React, { Suspense, lazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';

// Keep the workbench and route-specific tools out of the initial WebView parse path.
const App = lazy(() => import('./app/App.jsx'));
const FilePreviewApp = lazy(() => import('./app/FilePreviewApp.jsx'));
const DemoScreenshotApp = lazy(() => import('./demo/DemoScreenshotApp.jsx'));

const RootApp = window.location.pathname === '/preview/file'
  ? FilePreviewApp
  : window.location.pathname === '/demo/screenshots'
    ? DemoScreenshotApp
    : App;

function AppReady({ children }) {
  useEffect(() => {
    const startup = document.getElementById('codexmobile-startup');
    if (!startup) {
      return undefined;
    }
    startup.classList.add('is-ready');
    const removeTimer = window.setTimeout(() => startup.remove(), 180);
    return () => window.clearTimeout(removeTimer);
  }, []);

  return children;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      <AppReady>
        <RootApp />
      </AppReady>
    </Suspense>
  </React.StrictMode>
);
