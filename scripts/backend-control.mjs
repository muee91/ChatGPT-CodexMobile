/**
 * 可靠的本机后端控制器：以 PID 文件、端口归属校验和 /api/status 健康检查管理服务。
 * 日常启动不依赖 launchd；launchd 自动启动仍由 mac:autostart 单独管理。
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dataRoot = path.resolve(String(process.env.CODEXMOBILE_DATA_ROOT || '').trim() || root);
const runtimeDir = path.join(dataRoot, '.codexmobile');
const pidPath = path.join(runtimeDir, 'backend.pid');
const outPath = path.join(runtimeDir, 'server.out.log');
const errPath = path.join(runtimeDir, 'server.err.log');

function loadDotEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadDotEnv();
const port = Number(process.env.PORT || 3321);
const url = `http://127.0.0.1:${port}/api/status`;
const heapMb = Number(process.env.CODEXMOBILE_HEAP_MB || 8192);
const ioThreads = Math.max(
  4,
  Math.min(64, Number(process.env.CODEXMOBILE_IO_THREADS || process.env.UV_THREADPOOL_SIZE) || 16)
);

function commandForPid(pid) {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function workingDirectoryForPid(pid) {
  const result = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
  const match = String(result.stdout || '').match(/^n(.+)$/m);
  return match ? match[1] : '';
}

function isCodexMobilePid(pid) {
  const command = commandForPid(pid);
  // Some sandboxed shells cannot inspect another process's command line. The
  // listener's current directory is a safe fallback for this repository only.
  return command.includes('server/index.js')
    || command.includes('scripts/run-server.mjs')
    || workingDirectoryForPid(pid) === root;
}

function listenerPids() {
  if (process.platform === 'win32') return [];
  const result = spawnSync('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' });
  return String(result.stdout || '')
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function knownServerPids() {
  return listenerPids().filter(isCodexMobilePid);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid() {
  try {
    const data = JSON.parse(fs.readFileSync(pidPath, 'utf8'));
    return Number.isInteger(data.pid) && data.pid > 0 ? data.pid : 0;
  } catch {
    return 0;
  }
}

function removePidFile() {
  fs.rmSync(pidPath, { force: true });
}

async function healthCheck() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    const data = await response.json();
    return response.ok && Boolean(data.connected) ? data : null;
  } catch {
    return null;
  }
}

async function waitForHealthy(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await healthCheck();
    if (status) return status;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function describeForeignListener(pids) {
  return pids.map((pid) => `${pid} (${commandForPid(pid) || workingDirectoryForPid(pid) || 'unknown'})`).join(', ');
}

async function start() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const listenerPidList = listenerPids();
  const codexPids = knownServerPids();
  if (listenerPidList.length && !codexPids.length) {
    throw new Error(`端口 ${port} 正被其他进程占用，未执行启动：${describeForeignListener(listenerPidList)}`);
  }

  const alreadyHealthy = await healthCheck();
  if (alreadyHealthy && codexPids.length) {
    const pid = codexPids[0];
    fs.writeFileSync(pidPath, JSON.stringify({ pid, port, startedAt: new Date().toISOString() }) + '\n');
    console.log(`CodexMobile 后端已就绪，pid=${pid}`);
    console.log(`地址: ${url}`);
    return;
  }

  if (listenerPidList.length) {
    throw new Error(`端口 ${port} 已有 CodexMobile 进程但健康检查失败。请先运行 npm run backend:stop，再重新启动。`);
  }

  const existingPid = readPid();
  if (existingPid && !pidAlive(existingPid)) removePidFile();
  const nodeOptions = String(process.env.NODE_OPTIONS || '').includes('--max-old-space-size=')
    ? process.env.NODE_OPTIONS
    : [process.env.NODE_OPTIONS, `--max-old-space-size=${heapMb}`].filter(Boolean).join(' ');
  const out = fs.openSync(outPath, 'a');
  const err = fs.openSync(errPath, 'a');
  let child;
  try {
    child = spawn(process.execPath, [path.join(root, 'scripts', 'run-server.mjs')], {
      cwd: dataRoot,
      detached: true,
      stdio: ['ignore', out, err],
      // Session scans must not starve auth, status, and static-file I/O.
      env: { ...process.env, NODE_OPTIONS: nodeOptions, UV_THREADPOOL_SIZE: String(ioThreads) },
      windowsHide: true
    });
    child.unref();
  } finally {
    fs.closeSync(out);
    fs.closeSync(err);
  }
  fs.writeFileSync(pidPath, JSON.stringify({ pid: child.pid, port, startedAt: new Date().toISOString() }) + '\n');
  const status = await waitForHealthy();
  if (!status) {
    removePidFile();
    throw new Error(`后端在 20 秒内未就绪。请查看日志：${errPath}`);
  }
  console.log(`CodexMobile 后端启动成功，pid=${child.pid}`);
  console.log(`地址: ${url}`);
  console.log(`日志: ${outPath}`);
}

async function stop() {
  const pids = [...new Set([readPid(), ...knownServerPids()].filter(Boolean))]
    .filter(isCodexMobilePid);
  if (!pids.length) {
    removePidFile();
    console.log('CodexMobile 后端未运行。');
    return;
  }
  for (const pid of pids) process.kill(pid, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && pids.some(pidAlive)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const remaining = pids.filter(pidAlive);
  for (const pid of remaining) process.kill(pid, 'SIGKILL');
  removePidFile();
  console.log(`CodexMobile 后端已关闭，pid=${pids.join(', ')}`);
}

async function status() {
  const data = await healthCheck();
  const pids = knownServerPids();
  if (!data) {
    console.log(`CodexMobile 后端未就绪 (${url})`);
    process.exitCode = 1;
    return;
  }
  console.log(`CodexMobile 后端运行中，pid=${pids.join(', ') || 'unknown'}`);
  console.log(`地址: ${url}`);
  console.log(`状态: ${data.provider}/${data.model}，已同步=${data.syncedAt}`);
}

const command = process.argv[2] || 'status';
try {
  if (command === 'start') await start();
  else if (command === 'stop') await stop();
  else if (command === 'restart') { await stop(); await start(); }
  else if (command === 'status') await status();
  else throw new Error(`未知命令: ${command}。可用: start, stop, restart, status`);
} catch (error) {
  console.error(`后端${command}失败: ${error.message || error}`);
  process.exitCode = 1;
}
