/**
 * Cookie 认证 API 封装，并保留旧 localStorage Bearer token 的一次性迁移。
 *
 * Keywords: fetch, api, cookie-auth, bearer-migration, timeout
 *
 * Exports:
 * - getToken / setToken / clearToken / apiRequestHeaders — 旧 localStorage token 迁移兼容与请求头复用。
 * - getServerUrl / setServerUrl / clearServerUrl / getServerUrlHistory / forgetServerUrl — 客户端服务地址读写与切换记忆。
 * - resolveApiUrl / apiFetch / apiBlobFetch — 统一地址、headers、Cookie 凭据、超时与响应错误处理。
 * - websocketUrl — 返回 Cookie 鉴权的同源 WS 地址。
 *
 * Inward: fetch、localStorage。
 *
 * Outward: 客户端所有 REST 调用入口。
 */

const TOKEN_KEY = 'codexmobile.deviceToken';
const SERVER_URL_KEY = 'codexmobile.serverUrl';
const SERVER_URL_HISTORY_KEY = 'codexmobile.serverUrlHistory';
const SERVER_URL_HISTORY_LIMIT = 6;
const DEFAULT_SERVER_PORT = '3321';
const MIGRATED_HEADERS = ['x-codexmobile-token-migrated', 'x-codexmobile-clear-legacy-token'];
const STATUS_PROBE_PATH = '/api/status';

function storage() {
  return globalThis.localStorage || null;
}

function readServerUrlHistory() {
  try {
    const parsed = JSON.parse(storage()?.getItem(SERVER_URL_HISTORY_KEY) || '[]');
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((value) => normalizeServerUrl(value))
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .slice(0, SERVER_URL_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writeServerUrlHistory(history) {
  if (!history.length) {
    storage()?.removeItem(SERVER_URL_HISTORY_KEY);
    return;
  }
  storage()?.setItem(SERVER_URL_HISTORY_KEY, JSON.stringify(history.slice(0, SERVER_URL_HISTORY_LIMIT)));
}

function rememberServerUrl(value) {
  const normalized = normalizeServerUrl(value);
  if (!normalized) {
    return readServerUrlHistory();
  }
  const nextHistory = [
    normalized,
    ...readServerUrlHistory().filter((entry) => entry !== normalized)
  ].slice(0, SERVER_URL_HISTORY_LIMIT);
  writeServerUrlHistory(nextHistory);
  return nextHistory;
}

export function normalizeServerUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) {
    return '';
  }
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return '';
    }
    if (!url.port) {
      url.port = DEFAULT_SERVER_PORT;
    }
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function getServerUrl() {
  return normalizeServerUrl(storage()?.getItem(SERVER_URL_KEY) || import.meta.env?.VITE_CODEXMOBILE_SERVER_URL || '');
}

export function getServerUrlHistory() {
  const current = getServerUrl();
  const history = readServerUrlHistory();
  if (!current) {
    return history;
  }
  return [current, ...history.filter((entry) => entry !== current)].slice(0, SERVER_URL_HISTORY_LIMIT);
}

export function setServerUrl(value) {
  const normalized = normalizeServerUrl(value);
  if (normalized) {
    storage()?.setItem(SERVER_URL_KEY, normalized);
    rememberServerUrl(normalized);
    return normalized;
  }
  clearServerUrl();
  return '';
}

export function clearServerUrl() {
  storage()?.removeItem(SERVER_URL_KEY);
}

export function forgetServerUrl(value) {
  const normalized = normalizeServerUrl(value);
  if (!normalized) {
    return getServerUrlHistory();
  }
  if (getServerUrl() === normalized) {
    clearServerUrl();
  }
  const nextHistory = readServerUrlHistory().filter((entry) => entry !== normalized);
  writeServerUrlHistory(nextHistory);
  return getServerUrlHistory();
}

export function resolveApiUrl(path) {
  const configuredServerUrl = getServerUrl();
  if (!configuredServerUrl || /^https?:\/\//.test(path)) {
    return path;
  }
  return `${configuredServerUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function resolveApiUrlWithServerUrl(path, serverUrl = '') {
  if (!serverUrl || /^https?:\/\//.test(path)) {
    return path;
  }
  return `${serverUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export function getToken() {
  return storage()?.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  if (token) {
    storage()?.setItem(TOKEN_KEY, token);
    return;
  }
  clearToken();
}

export function clearToken() {
  storage()?.removeItem(TOKEN_KEY);
}

function maybeClearMigratedToken(response) {
  if (MIGRATED_HEADERS.some((header) => response.headers.get(header) === '1')) {
    clearToken();
  }
}

function legacyAuthHeaders(headers = {}) {
  const token = getToken();
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...headers
  };
}

export function apiRequestHeaders(headers = {}) {
  return legacyAuthHeaders(headers);
}

function isRecoverableNetworkError(error) {
  if (!error || error.name === 'AbortError') {
    return false;
  }
  if (Number.isFinite(Number(error.status))) {
    return false;
  }
  const message = String(error.message || '').trim().toLowerCase();
  return (
    error instanceof TypeError ||
    message.includes('failed to fetch') ||
    message.includes('load failed') ||
    message.includes('networkerror') ||
    message.includes('network request failed')
  );
}

async function probeServerUrl(serverUrl, fetchImpl = globalThis.fetch) {
  if (!serverUrl || typeof fetchImpl !== 'function') {
    return false;
  }
  try {
    const response = await fetchImpl(resolveApiUrlWithServerUrl(STATUS_PROBE_PATH, serverUrl), {
      method: 'GET',
      credentials: 'include'
    });
    if (!response?.ok) {
      return false;
    }
    const data = await response.json().catch(() => null);
    return Boolean(data?.connected);
  } catch {
    return false;
  }
}

async function recoverServerUrl(configuredServerUrl, fetchImpl = globalThis.fetch) {
  const candidates = [
    ...new Set(
      [configuredServerUrl, ...getServerUrlHistory()]
        .map((value) => normalizeServerUrl(value))
        .filter(Boolean)
    )
  ];

  for (const candidate of candidates) {
    if (candidate === configuredServerUrl) {
      continue;
    }
    if (await probeServerUrl(candidate, fetchImpl)) {
      setServerUrl(candidate);
      return candidate;
    }
  }

  try {
    const { scanLanServers } = await import('./server-scan.js');
    const results = await scanLanServers({
      currentServerUrl: configuredServerUrl,
      serverInput: configuredServerUrl,
      fetchImpl
    });
    const recovered = normalizeServerUrl(results?.[0]?.url || '');
    if (recovered && recovered !== configuredServerUrl) {
      setServerUrl(recovered);
      return recovered;
    }
  } catch {
    // Keep the original network error as the user-facing result.
  }

  return '';
}

async function performApiFetch(path, options = {}, serverUrlOverride = '') {
  const { timeoutMs: rawTimeoutMs, timeoutMessage, serverUrl: optionServerUrl = '', ...fetchOptions } = options;
  const timeoutMs = Number(rawTimeoutMs || 0);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeout = controller ? globalThis.setTimeout(() => controller.abort(), timeoutMs) : null;
  const effectiveServerUrl = normalizeServerUrl(serverUrlOverride || optionServerUrl || getServerUrl());
  const requestUrl = resolveApiUrlWithServerUrl(path, effectiveServerUrl);
  const headers = {
    ...(fetchOptions.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
    ...legacyAuthHeaders(fetchOptions.headers || {})
  };

  try {
    return await fetch(requestUrl, {
      ...fetchOptions,
      credentials: fetchOptions.credentials || (effectiveServerUrl ? 'include' : 'same-origin'),
      headers,
      signal: fetchOptions.signal || controller?.signal,
      body:
        fetchOptions.body && !(fetchOptions.body instanceof FormData) && typeof fetchOptions.body !== 'string'
          ? JSON.stringify(fetchOptions.body)
          : fetchOptions.body
    });
  } finally {
    if (timeout) {
      globalThis.clearTimeout(timeout);
    }
  }
}

export async function apiFetch(path, options = {}) {
  const configuredServerUrl = getServerUrl();

  let response;
  try {
    response = await performApiFetch(path, options);
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(options.timeoutMessage || '请求超时，请稍后重试');
      timeoutError.code = 'timeout';
      throw timeoutError;
    }
    if (configuredServerUrl && isRecoverableNetworkError(error)) {
      const recoveredServerUrl = await recoverServerUrl(configuredServerUrl);
      if (recoveredServerUrl) {
        response = await performApiFetch(path, options, recoveredServerUrl);
      } else {
        const networkError = new Error('当前桌面端地址不可用，请在手机端重新连接桌面服务');
        networkError.code = 'server_unreachable';
        throw networkError;
      }
    } else {
      throw error;
    }
  }

  maybeClearMigratedToken(response);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(data.error || `Request failed: ${response.status}`);
    error.status = response.status;
    error.code = data.code || null;
    throw error;
  }
  return data;
}

export async function apiBlobFetch(path, options = {}) {
  const configuredServerUrl = getServerUrl();
  const headers = {
    ...(options.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
    ...legacyAuthHeaders(options.headers || {})
  };

  const response = await fetch(resolveApiUrl(path), {
    ...options,
    credentials: options.credentials || (configuredServerUrl ? 'include' : 'same-origin'),
    headers,
    body:
      options.body && !(options.body instanceof FormData) && typeof options.body !== 'string'
        ? JSON.stringify(options.body)
        : options.body
  });

  maybeClearMigratedToken(response);
  if (!response.ok) {
    const text = await response.text();
    let message = `Request failed: ${response.status}`;
    let code = null;
    try {
      const data = text ? JSON.parse(text) : {};
      message = data.error || message;
      code = data.code || null;
    } catch {
      message = text || message;
    }
    const error = new Error(message);
    error.status = response.status;
    error.code = code;
    throw error;
  }

  return response.blob();
}

export function websocketUrl(ticket = '') {
  const configuredServerUrl = getServerUrl();
  if (configuredServerUrl) {
    const serverUrl = new URL(configuredServerUrl);
    serverUrl.protocol = serverUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    serverUrl.pathname = '/ws';
    serverUrl.search = '';
    serverUrl.hash = '';
    if (ticket) {
      serverUrl.searchParams.set('ticket', ticket);
    }
    return serverUrl.toString();
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export async function createWebSocketTicket() {
  const result = await apiFetch('/api/auth/ws-ticket', { method: 'POST' });
  return String(result?.ticket || '').trim();
}
