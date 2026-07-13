/**
 * 手机端配对流程：解析终端或二维码配对链接、提交验证码，并处理服务端 Cookie 登录。
 *
 * Keywords: pairing, cookie-auth, qr, terminal-code, device-name
 *
 * Exports:
 * - defaultDeviceName — 从浏览器环境生成设备名。
 * - normalizePairingCode / pairingRequestFromSearch / pairingRequestFromText — 规范配对码与解析终端或二维码配对链接。
 * - startPairingRequest / completePairing — 调用配对接口的薄封装。
 *
 * Inward（本模块依赖/组装的关键符号）: apiFetch、normalizeServerUrl、navigator user agent。
 *
 * Outward（谁在用/调用场景）: app/PairingScreen.jsx 与 pairing-flow 测试。
 *
 * 不负责: 页面布局。
 */
import { apiFetch, normalizeServerUrl, setToken } from './api.js';

const PAIRING_FETCH_TIMEOUT_MS = 10_000;

export function defaultDeviceName(navigatorLike = globalThis.navigator) {
  const platform = String(navigatorLike?.platform || '').trim();
  const userAgent = String(navigatorLike?.userAgent || '').trim();
  if (/iphone/i.test(platform) || /iphone/i.test(userAgent)) return 'iPhone';
  if (/ipad/i.test(platform) || /ipad/i.test(userAgent)) return 'iPad';
  if (/android/i.test(userAgent)) return 'Android';
  if (/mac/i.test(platform) || /macintosh|mac os x/i.test(userAgent)) return 'Mac';
  if (/win/i.test(platform) || /windows/i.test(userAgent)) return 'Windows PC';
  if (/linux/i.test(platform) || /linux/i.test(userAgent)) return 'Linux';
  return 'Browser';
}

export function normalizePairingCode(value, codeLength = 0) {
  const length = Math.max(0, Number(codeLength) || 0);
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();
  return length ? normalized.slice(0, length) : normalized;
}

export function pairingRequestFromSearch(search = '') {
  return pairingRequestFromParams(new URLSearchParams(String(search || '').replace(/^\?/, '')));
}

function pairingRequestFromParams(params, { serverUrl = '' } = {}) {
  const requestId = String(params.get('requestId') || '').trim();
  const codeLength = Math.max(1, Number(params.get('codeLength')) || 10);
  const code = normalizePairingCode(params.get('code'), codeLength);
  if (!requestId || code.length !== codeLength) {
    return null;
  }
  return {
    requestId,
    code,
    codeLength,
    autoSubmit: true,
    serverUrl: normalizeServerUrl(serverUrl)
  };
}

export function pairingRequestFromText(value = '') {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  if (text.startsWith('?') || text.startsWith('requestId=')) {
    return pairingRequestFromParams(new URLSearchParams(text.replace(/^\?/, '')));
  }
  try {
    const url = new URL(text);
    return pairingRequestFromParams(url.searchParams, { serverUrl: url.origin });
  } catch {
    return null;
  }
}

export function pairingServerUrlFromQr(qrServerUrl = '', selectedServerUrl = '') {
  return normalizeServerUrl(qrServerUrl) || normalizeServerUrl(selectedServerUrl);
}

export async function startPairingRequest({ deviceName = defaultDeviceName(), serverUrl = '' } = {}) {
  return apiFetch('/api/pair/request', {
    method: 'POST',
    serverUrl,
    timeoutMs: PAIRING_FETCH_TIMEOUT_MS,
    timeoutMessage: '连接电脑端超时，请确认手机和电脑在同一网络，或重新选择电脑地址。',
    body: {
      deviceName
    }
  });
}

export async function completePairing({ requestId, code, deviceName = defaultDeviceName(), serverUrl = '' }) {
  const result = await apiFetch('/api/pair', {
    method: 'POST',
    serverUrl,
    timeoutMs: PAIRING_FETCH_TIMEOUT_MS,
    timeoutMessage: '提交配对码超时，请确认电脑端服务仍在运行。',
    body: {
      requestId,
      code: normalizePairingCode(code),
      deviceName
    }
  });
  if (result?.token) {
    setToken(result.token);
  }
  return result;
}
