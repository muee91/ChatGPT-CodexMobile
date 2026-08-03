/**
 * 兼容旧入口：转交给可靠的 PID/健康检查后端控制器。
 *
 * Keywords: dev-server, backend-control, health-check, pid
 *
 * Exports:
 * - 无 default，CLI 自执行。
 *
 * Inward（本模块依赖/组装的关键符号）: backend-control.mjs。
 *
 * Outward（谁在用/调用场景）: package.json start:bg；本地手动 node scripts/start-server.mjs。
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const result = spawnSync(process.execPath, ['scripts/backend-control.mjs', 'start'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});
process.exit(result.status ?? 1);
