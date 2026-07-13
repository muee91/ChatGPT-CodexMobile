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

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import FilePreviewApp from './app/FilePreviewApp.jsx';
import DemoScreenshotApp from './demo/DemoScreenshotApp.jsx';
import './styles/index.css';

const RootApp = window.location.pathname === '/preview/file'
  ? FilePreviewApp
  : window.location.pathname === '/demo/screenshots'
    ? DemoScreenshotApp
    : App;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
);
