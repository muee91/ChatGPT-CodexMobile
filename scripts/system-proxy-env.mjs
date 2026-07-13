/**
 * 在 macOS 上读取 scutil --proxy 并将系统 HTTP(S) 代理写入进程环境（尊重已有代理变量）。
 *
 * Keywords: macOS, scutil, proxy, HTTPS_PROXY, environment
 *
 * Exports:
 * - hasExplicitProxyEnv — 环境是否已显式配置代理键。
 * - proxyUrlFromScutilOutput — 解析 scutil 文本为 http://host:port。
 * - applyMacSystemProxyEnv — 按需写入 HTTPS_PROXY 等并返回是否生效。
 *
 * Inward（本模块依赖/组装的关键符号）: node:child_process spawnSync（默认 /usr/sbin/scutil）。
 *
 * Outward（谁在用/调用场景）: scripts/run-server.mjs、start-server.mjs。
 */

import { spawnSync } from 'node:child_process';

const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];
const DEFAULT_NO_PROXY = '127.0.0.1,localhost,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,*.local';

function scutilValue(output, key) {
  const match = String(output || '').match(new RegExp(`\\b${key}\\s*:\\s*([^\\n]+)`));
  return match ? match[1].trim() : '';
}

function scutilEnabled(output, key) {
  return scutilValue(output, key) === '1';
}

export function hasExplicitProxyEnv(env = process.env) {
  return PROXY_ENV_KEYS.some((key) => String(env[key] || '').trim());
}

export function proxyUrlFromScutilOutput(output) {
  const raw = String(output || '');
  const httpsHost = scutilValue(raw, 'HTTPSProxy');
  const httpsPort = scutilValue(raw, 'HTTPSPort');
  if (scutilEnabled(raw, 'HTTPSEnable') && httpsHost && httpsPort) {
    return `http://${httpsHost}:${httpsPort}`;
  }
  const httpHost = scutilValue(raw, 'HTTPProxy');
  const httpPort = scutilValue(raw, 'HTTPPort');
  if (scutilEnabled(raw, 'HTTPEnable') && httpHost && httpPort) {
    return `http://${httpHost}:${httpPort}`;
  }
  return '';
}

export function applyMacSystemProxyEnv(env = process.env, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'darwin' || env.CODEXMOBILE_USE_SYSTEM_PROXY === '0' || hasExplicitProxyEnv(env)) {
    return { applied: false, proxyUrl: '' };
  }

  const command = options.scutilPath || '/usr/sbin/scutil';
  const result = spawnSync(command, ['--proxy'], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) {
    return { applied: false, proxyUrl: '' };
  }

  const proxyUrl = proxyUrlFromScutilOutput(result.stdout);
  if (!proxyUrl) {
    return { applied: false, proxyUrl: '' };
  }

  env.HTTPS_PROXY = proxyUrl;
  env.HTTP_PROXY = proxyUrl;
  env.ALL_PROXY = proxyUrl;
  if (!env.NO_PROXY && !env.no_proxy) {
    env.NO_PROXY = DEFAULT_NO_PROXY;
  }
  return { applied: true, proxyUrl };
}
