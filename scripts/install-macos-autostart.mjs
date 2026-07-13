/**
 * 安装或卸载 macOS LaunchAgent，使 CodexMobile 在登录后由 run-server.mjs 拉起。
 *
 * Keywords: macOS, LaunchAgent, launchctl, autostart, plist
 *
 * Exports:
 * - 无 default，CLI 自执行。
 *
 * Inward（本模块依赖/组装的关键符号）: launchctl、lsof；scripts/run-server.mjs。
 *
 * Outward（谁在用/调用场景）: package.json mac:autostart / mac:autostart:remove。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const label = 'com.codexmobile.bridge';
const root = path.resolve(import.meta.dirname, '..');
const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
const plistPath = path.join(plistDir, `${label}.plist`);
const nodePath = process.execPath;
const runScript = path.join(root, 'scripts', 'run-server.mjs');
const port = Number(process.env.PORT || 3321);
const defaultHeapMb = Number(process.env.CODEXMOBILE_HEAP_MB || 8192);
const uid = process.getuid?.();
const domain = Number.isInteger(uid) ? `gui/${uid}` : 'gui';
const uninstall = process.argv.includes('--uninstall');

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function launchctl(args, { allowFailure = false } = {}) {
  const result = spawnSync('launchctl', args, {
    encoding: 'utf8'
  });
  if (!allowFailure && result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`launchctl ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
  return result;
}

function listenerPidsForPort(value) {
  const result = spawnSync('lsof', [`-tiTCP:${value}`, '-sTCP:LISTEN'], {
    encoding: 'utf8'
  });
  if (result.status !== 0 && !result.stdout) {
    return [];
  }
  return String(result.stdout || '')
    .split(/\s+/)
    .map((item) => Number(item))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
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
  const pids = listenerPidsForPort(port)
    .filter((pid) => {
      const command = commandForPid(pid);
      return command.includes('/server/index.js') ||
        command.includes('server/index.js') ||
        command.includes('/scripts/run-server.mjs') ||
        command.includes('scripts/run-server.mjs');
    });
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`Stopped existing CodexMobile server pid=${pid}`);
    } catch {
      // Process already exited.
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (pids.every((pid) => !pidIsAlive(pid))) {
      return;
    }
    await sleep(100);
  }
  for (const pid of pids) {
    if (pidIsAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
        console.log(`Force-stopped existing CodexMobile server pid=${pid}`);
      } catch {
        // Process already exited.
      }
    }
  }
}

function plist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(runScript)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(root)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(root, '.codexmobile', 'launchd.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(root, '.codexmobile', 'launchd.err.log'))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${xmlEscape(os.homedir())}</string>
    <key>PATH</key>
    <string>${xmlEscape(process.env.PATH || '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin')}</string>
    <key>NODE_OPTIONS</key>
    <string>${xmlEscape(`--max-old-space-size=${defaultHeapMb}`)}</string>
  </dict>
</dict>
</plist>
`;
}

function bootoutExisting() {
  launchctl(['bootout', domain, plistPath], { allowFailure: true });
  launchctl(['remove', label], { allowFailure: true });
}

if (uninstall) {
  bootoutExisting();
  if (fs.existsSync(plistPath)) {
    fs.unlinkSync(plistPath);
  }
  console.log(`Removed ${label}`);
  process.exit(0);
}

fs.mkdirSync(plistDir, { recursive: true });
fs.mkdirSync(path.join(root, '.codexmobile'), { recursive: true });
fs.writeFileSync(plistPath, plist(), 'utf8');

bootoutExisting();
await stopExistingServer();
launchctl(['bootstrap', domain, plistPath]);
launchctl(['enable', `${domain}/${label}`], { allowFailure: true });
launchctl(['kickstart', '-k', `${domain}/${label}`], { allowFailure: true });

console.log(`Installed ${label}`);
console.log(`Plist: ${plistPath}`);
console.log(`Command: ${nodePath} ${runScript}`);
