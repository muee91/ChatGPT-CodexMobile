/**
 * Vite 根入口的默认导出：转发到 app/App.jsx 实现。
 *
 * Keywords: entry, App, re-export, root
 *
 * Exports:
 * - default — 与 app/App.jsx 相同的根组件实现。
 *
 * Inward: ./app/App.jsx。
 *
 * Outward: main.jsx 动态选择普通应用或预览路由时挂载。
 */

export { default } from './app/App.jsx';
