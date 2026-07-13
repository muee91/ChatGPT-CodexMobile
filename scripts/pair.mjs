/**
 * 终端配对入口：向本机服务申请一次性配对码，并打印手机可打开的链接。
 *
 * Keywords: pairing, cli, terminal, localhost
 *
 * Exports:
 * - runPairCli — CLI 主流程，可被 up 脚本复用。
 * - formatPairingCode / pairingUrlsForHosts / qrPageUrlsForHosts — 终端展示与链接构造辅助。
 *
 * Inward（本模块依赖/组装的关键符号）: 本机 /api/pair/terminal-request、Node os。
 *
 * Outward（谁在用/调用场景）: package.json pair / scripts/up.mjs。
 *
 * 不负责: 启动服务；服务未运行时提示用户先运行 up/start:bg。
 */

import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import QRCode from 'qrcode';

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

function portFromEnv() {
  return Number(process.env.PORT || 3321);
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text) {
    return '';
  }
  try {
    return new URL(text).origin;
  } catch {
    return '';
  }
}

function lanHosts() {
  const hosts = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal || !entry.address || !isPrivateOrTailscaleIpv4(entry.address)) {
        continue;
      }
      hosts.push(entry.address);
    }
  }
  return [...new Set(hosts)];
}

function isPrivateOrTailscaleIpv4(address) {
  const parts = String(address || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127);
}

export function formatPairingCode(code = '') {
  return String(code || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

export function pairingUrlsForHosts({ requestId, code, codeLength, port = portFromEnv(), publicUrl = '' } = {}) {
  const params = new URLSearchParams({
    requestId: String(requestId || ''),
    code: String(code || ''),
    codeLength: String(codeLength || 10)
  });
  const pathWithQuery = `/pair?${params.toString()}`;
  const bases = [
    normalizeBaseUrl(publicUrl),
    ...lanHosts().map((host) => `http://${host}:${port}`),
    `http://127.0.0.1:${port}`
  ].filter(Boolean);
  return [...new Set(bases)].map((base) => `${base}${pathWithQuery}`);
}

export function qrPageUrlsForHosts({ requestId, code, codeLength, port = portFromEnv(), publicUrl = '' } = {}) {
  return pairingUrlsForHosts({ requestId, code, codeLength, port, publicUrl })
    .map((url) => {
      const parsed = new URL(url);
      parsed.pathname = '/pair/qr';
      return parsed.toString();
    });
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 5000);
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfterSeconds = Number(data.retryAfterSeconds || response.headers.get('retry-after') || 0);
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function readStatus(port) {
  try {
    return await fetchJson(`http://127.0.0.1:${port}/api/status`, { timeoutMs: 3000 });
  } catch {
    return {};
  }
}

function isRetryableStartupError(error) {
  return error.cause?.code === 'ECONNREFUSED' ||
    error.code === 'ECONNREFUSED' ||
    error.name === 'AbortError' ||
    error.status === 502 ||
    error.status === 503;
}

async function requestTerminalPairing(baseUrl, deviceName) {
  let lastError = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await fetchJson(`${baseUrl}/api/pair/terminal-request`, {
        method: 'POST',
        body: { deviceName },
        timeoutMs: 3000
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableStartupError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError || new Error('CodexMobile service is unavailable');
}

export async function runPairCli({ port = portFromEnv(), deviceName = `${os.hostname()} terminal` } = {}) {
  loadDotEnv();
  const baseUrl = `http://127.0.0.1:${port}`;
  let result;
  try {
    result = await requestTerminalPairing(baseUrl, deviceName);
  } catch (error) {
    if (isRetryableStartupError(error)) {
      console.error(`CodexMobile 服务暂时不可用：${baseUrl}`);
      console.error('请先运行 npm run up，或单独运行 npm run start:bg 后再运行 npm run pair。');
      process.exitCode = 1;
      return null;
    }
    if (error.retryAfterSeconds > 0) {
      console.error(`配对请求太频繁，请 ${error.retryAfterSeconds}s 后再试。`);
    } else {
      console.error(`配对码生成失败：${error.message}`);
    }
    process.exitCode = 1;
    return null;
  }

  const status = await readStatus(port);
  const urls = pairingUrlsForHosts({
    requestId: result.requestId,
    code: result.code,
    codeLength: result.codeLength,
    port,
    publicUrl: status.security?.publicUrl || process.env.CODEXMOBILE_PUBLIC_URL || ''
  });
  const qrUrls = qrPageUrlsForHosts({
    requestId: result.requestId,
    code: result.code,
    codeLength: result.codeLength,
    port,
    publicUrl: status.security?.publicUrl || process.env.CODEXMOBILE_PUBLIC_URL || ''
  });
  const primaryUrl = urls[0] || `${baseUrl}/`;
  const expiresAt = result.expiresAt ? new Date(result.expiresAt) : null;
  const minutes = expiresAt ? Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 60000)) : 10;
  const terminalQr = await QRCode.toString(primaryUrl, {
    type: 'terminal',
    small: true
  });

  console.log('');
  console.log('CodexMobile 配对');
  console.log('');
  console.log(`配对码：${formatPairingCode(result.code)}`);
  console.log(`${minutes} 分钟内有效。`);
  console.log('');
  console.log(terminalQr);
  console.log('');
  console.log('手机打开下面任一地址：');
  for (const url of urls) {
    console.log(`  ${url}`);
  }
  console.log('');
  console.log('如需更大的二维码，可在电脑浏览器打开：');
  for (const url of qrUrls) {
    console.log(`  ${url}`);
  }
  console.log('');
  console.log('打开后会自动完成配对；如果没有自动完成，就手动输入上面的配对码。');
  console.log('');
  return { ...result, urls, qrUrls };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  runPairCli().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
