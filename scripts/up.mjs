/**
 * 一站式启动入口：构建前端、启动或重启本机服务，然后在当前终端输出配对入口。
 *
 * Keywords: startup, pairing, build, server, cli
 *
 * Exports:
 * - 无 default，CLI 自执行。
 *
 * Inward（本模块依赖/组装的关键符号）: npm build、scripts/start-server.mjs、scripts/pair.mjs。
 *
 * Outward（谁在用/调用场景）: package.json up。
 *
 * 不负责: 设备 token 存储与 Cookie 写入。
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { runPairCli } from './pair.mjs';

const root = path.resolve(import.meta.dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const port = Number(process.env.PORT || 3321);

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`${label} 失败，退出码 ${result.status}`);
  }
}

async function waitForServer() {
  const url = `http://127.0.0.1:${port}/api/status`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`服务启动超时：${url}`);
}

try {
  run(npmCommand, ['run', 'build'], '前端构建');
  run(process.execPath, ['scripts/start-server.mjs'], '服务启动');
  await waitForServer();
  await runPairCli({ port });
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
