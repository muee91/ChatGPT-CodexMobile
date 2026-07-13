/**
 * 开发/本机启动器：加载 .env、应用系统代理，前台或后台 spawn Node 跑 server/index.js 并写日志。
 *
 * Keywords: dev-server, dotenv, spawn, logging, system-proxy
 *
 * Exports:
 * - 无 default，CLI 自执行。
 *
 * Inward（本模块依赖/组装的关键符号）: system-proxy-env.mjs；.codexmobile 日志目录。
 *
 * Outward（谁在用/调用场景）: package.json start:bg；本地手动 node scripts/start-server.mjs。
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { applyMacSystemProxyEnv } from './system-proxy-env.mjs';

const root = path.resolve(import.meta.dirname, '..');
const logDir = path.join(root, '.codexmobile');
const port = Number(process.env.PORT || 3321);
const launchdLabel = 'com.codexmobile.bridge';
const DEFAULT_SERVER_HEAP_MB = Number(process.env.CODEXMOBILE_HEAP_MB || 8192);
fs.mkdirSync(logDir, { recursive: true });

const outPath = path.join(logDir, 'server.out.log');
const errPath = path.join(logDir, 'server.err.log');

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

function dedupePath(value) {
  const seen = new Set();
  return String(value || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const key = process.platform === 'win32' ? item.toLowerCase() : item;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .join(path.delimiter);
}

function childEnv() {
  if (process.platform !== 'win32') {
    return {
      ...process.env,
      NODE_OPTIONS: withServerHeapNodeOptions(process.env.NODE_OPTIONS)
    };
  }

  const env = {};
  const seen = new Set();
  for (const [key, value] of Object.entries(process.env)) {
    const normalized = key.toLowerCase();
    if (normalized === 'path' || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    env[key] = value;
  }

  env.Path = dedupePath([
    process.env.Path,
    process.env.PATH
  ].filter(Boolean).join(path.delimiter));
  env.NODE_OPTIONS = withServerHeapNodeOptions(process.env.NODE_OPTIONS);
  return env;
}

function withServerHeapNodeOptions(currentValue = '') {
  const current = String(currentValue || '').trim();
  if (current.includes('--max-old-space-size=')) {
    return current;
  }
  return [current, `--max-old-space-size=${DEFAULT_SERVER_HEAP_MB}`]
    .filter(Boolean)
    .join(' ')
    .trim();
}

loadDotEnv();
const proxyEnv = applyMacSystemProxyEnv();
if (proxyEnv.applied) {
  console.log(`Using macOS system proxy for background Codex requests: ${proxyEnv.proxyUrl}`);
}

function launchdDomain() {
  const uid = process.getuid?.();
  return Number.isInteger(uid) ? `gui/${uid}` : 'gui';
}

function restartLaunchAgentIfInstalled() {
  if (process.platform !== 'darwin') {
    return false;
  }
  const domain = launchdDomain();
  const serviceName = `${domain}/${launchdLabel}`;
  const printResult = spawnSync('launchctl', ['print', serviceName], {
    encoding: 'utf8'
  });
  if (printResult.status !== 0) {
    return false;
  }
  const output = `${printResult.stdout || ''}\n${printResult.stderr || ''}`;
  if (!output.includes(root) || !output.includes('scripts/run-server.mjs')) {
    return false;
  }
  const result = spawnSync('launchctl', ['kickstart', '-k', serviceName], {
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`launchctl kickstart failed${detail ? `:\n${detail}` : ''}`);
  }
  console.log(`CodexMobile is managed by launchd; restarted ${launchdLabel}.`);
  console.log(`Logs: ${path.join(logDir, 'launchd.out.log')}`);
  return true;
}

function listenerPidsForPort(value) {
  if (process.platform === 'win32') {
    return [];
  }
  const result = spawnSync('lsof', [`-tiTCP:${value}`, '-sTCP:LISTEN'], {
    encoding: 'utf8'
  });
  if (result.status !== 0 && !result.stdout) {
    return [];
  }
  return String(result.stdout || '')
    .split(/\s+/)
    .map((item) => Number(item))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function commandForPid(pid) {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf8'
  });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopExistingServer() {
  const pids = listenerPidsForPort(port).filter((pid) => {
    const command = commandForPid(pid);
    return command.includes('server/index.js') || command.includes('scripts/run-server.mjs');
  });
  if (!pids.length) {
    return;
  }
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process already exited.
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (pids.every((pid) => !pidIsAlive(pid))) {
      console.log(`Stopped existing CodexMobile server on port ${port}: ${pids.join(', ')}`);
      return;
    }
    await sleep(100);
  }
  for (const pid of pids) {
    if (pidIsAlive(pid)) {
      process.kill(pid, 'SIGKILL');
    }
  }
  console.log(`Force-stopped existing CodexMobile server on port ${port}: ${pids.join(', ')}`);
}

if (restartLaunchAgentIfInstalled()) {
  process.exit(0);
}

await stopExistingServer();

const out = fs.openSync(outPath, 'a');
const err = fs.openSync(errPath, 'a');
try {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true,
    env: childEnv()
  });

  child.unref();
  console.log(`CodexMobile server started in background, pid=${child.pid}`);
  console.log(`Logs: ${outPath}`);
} finally {
  fs.closeSync(out);
  fs.closeSync(err);
}
process.exit(0);
