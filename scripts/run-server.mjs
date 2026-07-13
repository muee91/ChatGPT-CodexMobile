/**
 * LaunchAgent / 后台入口：加载 .env、注入 macOS 系统代理后启动 HTTP 服务进程。
 *
 * Keywords: launchd, dotenv, system-proxy, server-bootstrap
 *
 * Exports:
 * - 无 default，动态 import server/index.js。
 *
 * Inward（本模块依赖/组装的关键符号）: system-proxy-env.mjs；仓库根 .env。
 *
 * Outward（谁在用/调用场景）: install-macos-autostart 生成的 plist ProgramArguments。
 */

import fs from 'node:fs';
import path from 'node:path';
import { applyMacSystemProxyEnv } from './system-proxy-env.mjs';

const root = path.resolve(import.meta.dirname, '..');

function loadDotEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadDotEnv();
const proxyEnv = applyMacSystemProxyEnv();
if (proxyEnv.applied) {
  console.log(`[launchd] Using macOS system proxy for background Codex requests: ${proxyEnv.proxyUrl}`);
}
console.log(`[launchd] CodexMobile run-server starting cwd=${process.cwd()} node=${process.execPath}`);
await import('../server/index.js');
