/**
 * Vite 构建配置：注入应用版本号并配置本地开发代理。
 *
 * Keywords: vite, version, dev-proxy
 *
 * Exports:
 * - default — CodexMobile 前端 Vite 配置。
 *
 * Inward: package.json 版本号、React 插件。
 *
 * Outward: `npm run dev:client` 与 `npm run build`。
 */

import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export default defineConfig({
  root: 'client',
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version)
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3321',
      '/ws': {
        target: 'ws://127.0.0.1:3321',
        ws: true
      }
    }
  }
});
