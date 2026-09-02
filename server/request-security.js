/**
 * HTTP 请求层安全工具：Cookie token、响应安全头、Origin 与 Fetch-Site 防护。
 *
 * Keywords: cookie-auth, csrf, security-headers, origin, fetch-site
 *
 * Exports:
 * - AUTH_COOKIE / parseCookies / extractCookieToken / extractRequestToken。
 * - buildAuthCookie / clearAuthCookie — 设置或清理 HttpOnly 设备 Cookie。
 * - setSecurityHeaders / rejectUnsafeOrigin / rejectSuspiciousFetchSite — 请求与响应防护。
 *
 * Inward（本模块依赖/组装的关键符号）: Node HTTP headers、security-options。
 *
 * Outward（谁在用/调用场景）: server/index 认证与请求入口。
 *
 * 不负责: token 校验与设备状态。
 */
import { sameOriginAllowed } from './security-options.js';

export const AUTH_COOKIE = 'codexmobile_token';

function safeDecodeCookieValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseCookies(header = '') {
  const result = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      const decoded = safeDecodeCookieValue(value);
      if (decoded !== null) {
        result[key] = decoded;
      }
    }
  }
  return result;
}

export function extractCookieToken(req) {
  return parseCookies(req.headers?.cookie || '')[AUTH_COOKIE] || '';
}

export function extractRequestToken(req, { allowBearer = false, allowQuery = false } = {}) {
  const cookieToken = extractCookieToken(req);
  if (cookieToken) {
    return { token: cookieToken, source: 'cookie' };
  }
  if (allowQuery) {
    try {
      const host = String(req.headers?.host || '127.0.0.1').split(',')[0].trim() || '127.0.0.1';
      const url = new URL(req.url || '/', `http://${host}`);
      const queryToken = String(url.searchParams.get('token') || '').trim();
      if (queryToken) {
        return { token: queryToken, source: 'query' };
      }
    } catch {
      // ignore malformed URL
    }
  }
  if (!allowBearer) {
    return { token: '', source: '' };
  }
  const header = String(req.headers?.authorization || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? { token: match[1].trim(), source: 'bearer' } : { token: '', source: '' };
}

export function buildAuthCookie(token, { secure = false, maxAgeSeconds } = {}) {
  const parts = [
    `${AUTH_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict'
  ];
  if (secure) {
    parts.push('Secure');
  }
  if (Number.isFinite(maxAgeSeconds)) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  }
  return parts.join('; ');
}

export function clearAuthCookie({ secure = false } = {}) {
  return buildAuthCookie('', { secure, maxAgeSeconds: 0 });
}

export function contentSecurityPolicy({ frameAncestors = "'none'" } = {}) {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' https: wss:",
    "font-src 'self' data:",
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ');
}

export function setSecurityHeaders(
  res,
  {
    secure = false,
    cspReportOnly = false,
    frameAncestors = "'none'",
    frameOptions = 'DENY',
    permissionsPolicy = 'camera=(), geolocation=(), microphone=()'
  } = {}
) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', frameOptions);
  res.setHeader(cspReportOnly ? 'content-security-policy-report-only' : 'content-security-policy', contentSecurityPolicy({ frameAncestors }));
  res.setHeader('permissions-policy', permissionsPolicy);
  if (secure) {
    res.setHeader('strict-transport-security', 'max-age=15552000; includeSubDomains');
  }
}

export function rejectUnsafeOrigin(req, options) {
  const method = String(req.method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return null;
  }
  const origin = String(req.headers.origin || '').trim();
  if (!origin || sameOriginAllowed(origin, options)) {
    return null;
  }
  return { statusCode: 403, error: 'Cross-origin request rejected' };
}

export function rejectSuspiciousFetchSite(req, { protectSafeMethod = false } = {}) {
  const method = String(req.method || 'GET').toUpperCase();
  const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (isSafeMethod && !protectSafeMethod) {
    return null;
  }
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  const allowedFetchSites = isSafeMethod
    ? ['', 'same-origin', 'none']
    : ['', 'same-origin', 'same-site', 'none'];
  if (allowedFetchSites.includes(fetchSite)) {
    return null;
  }
  return { statusCode: 403, error: 'Cross-site request rejected' };
}
