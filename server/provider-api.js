/**
 * 从 Codex config.toml 等读取 OpenAI 兼容 API 与 CLI 代理密钥，供标题/配图等调用。
 *
 * Keywords: provider-api, openai-compatible, codex-config, api-key
 *
 * Exports:
 * - DEFAULT_OPENAI_COMPATIBLE_BASE_URL — 默认本机 CLI 代理地址。
 * - normalizeBaseUrl — URL规整。
 * - readCodexProviderBaseUrl / readCliProxyApiKeys — 读取配置。
 * - openAICompatibleConfig — 组装 fetch 用 baseURL 与 headers。
 *
 * Inward（本模块依赖/组装的关键符号）: codex-config（CODEX_CONFIG_PATH）、node:fs。
 *
 * Outward（谁在用/调用场景）: session-title-generator、voice、image-generator 等。
 *
 * 不负责: 实际 HTTP 请求重试策略。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CODEX_CONFIG_PATH } from './codex-config.js';

export const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'http://127.0.0.1:8317/v1';

function stripQuotes(value) {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function normalizeBaseUrl(value, fallback = DEFAULT_OPENAI_COMPATIBLE_BASE_URL) {
  return String(value || fallback).replace(/\/+$/, '');
}

export async function readCodexProviderBaseUrl() {
  let raw = '';
  try {
    raw = await fs.readFile(CODEX_CONFIG_PATH, 'utf8');
  } catch {
    return null;
  }

  let provider = 'cliproxyapi';
  let currentProvider = null;
  const baseUrls = new Map();

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const providerMatch = line.match(/^\[model_providers\.(?:'([^']+)'|"([^"]+)"|([^\]]+))\]$/);
    if (providerMatch) {
      currentProvider = stripQuotes(providerMatch[1] || providerMatch[2] || providerMatch[3]);
      continue;
    }
    if (line.startsWith('[')) {
      currentProvider = null;
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!assignment) {
      continue;
    }
    const key = assignment[1];
    const value = stripQuotes(assignment[2]);
    if (!currentProvider && key === 'model_provider') {
      provider = value;
    } else if (currentProvider && key === 'base_url') {
      baseUrls.set(currentProvider, value);
    }
  }

  return baseUrls.get(provider) || null;
}

export async function readCliProxyApiKeys(extraKeys = []) {
  const keys = [
    ...extraKeys,
    process.env.CLIPROXYAPI_API_KEY,
    process.env.CLI_PROXY_API_KEY
  ].filter(Boolean);
  const candidates = [
    process.env.CLIPROXYAPI_CONFIG,
    process.platform === 'win32' ? 'D:\\CLIProxyAPI\\config.yaml' : '',
    path.join(os.homedir(), '.cli-proxy-api', 'config.yaml')
  ].filter(Boolean);

  for (const configPath of candidates) {
    let raw = '';
    try {
      raw = await fs.readFile(configPath, 'utf8');
    } catch {
      continue;
    }

    let inApiKeys = false;
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (/^api-keys\s*:\s*$/.test(line.trim())) {
        inApiKeys = true;
        continue;
      }
      if (inApiKeys && /^\S/.test(line)) {
        break;
      }
      const match = inApiKeys ? line.match(/^\s*-\s*(.+?)\s*(?:#.*)?$/) : null;
      if (match) {
        const key = stripQuotes(match[1]);
        if (key && !keys.includes(key)) {
          keys.push(key);
        }
      }
    }
  }

  if (process.env.OPENAI_API_KEY && !keys.includes(process.env.OPENAI_API_KEY)) {
    keys.push(process.env.OPENAI_API_KEY);
  }

  return keys;
}

export async function openAICompatibleConfig({
  baseUrl,
  defaultBaseUrl = DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  apiKeys = []
} = {}) {
  const resolvedBaseUrl = baseUrl || (await readCodexProviderBaseUrl()) || defaultBaseUrl;
  return {
    baseUrl: normalizeBaseUrl(resolvedBaseUrl, defaultBaseUrl),
    apiKeys: await readCliProxyApiKeys(apiKeys)
  };
}
