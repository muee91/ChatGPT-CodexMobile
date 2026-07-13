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

import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/index.css';

// Keep document conversion and screenshot-only code out of the chat startup path.
const FilePreviewApp = lazy(() => import('./app/FilePreviewApp.jsx'));
const DemoScreenshotApp = lazy(() => import('./demo/DemoScreenshotApp.jsx'));

const RootApp = window.location.pathname === '/preview/file'
  ? FilePreviewApp
  : window.location.pathname === '/demo/screenshots'
    ? DemoScreenshotApp
    : App;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Suspense fallback={<main role="status">正在加载…</main>}>
      <RootApp />
    </Suspense>
  </React.StrictMode>
);
