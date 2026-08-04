/**
 * HTTP 通用工具：JSON/HTML 响应、gzip 静态、请求体与安全路径解析。
 *
 * Keywords: http-utils, gzip, readBody, sendJson, pairing-authority
 *
 * Exports:
 * - DEFAULT_COMPRESSIBLE_EXTENSIONS — 可压缩静态扩展名集合。
 * - sanitizeJsonPayload / sendJson / sendHtml / htmlEscape — 响应、敏感字段收敛与转义。
 * - hardenPairingRequestAuthority — 配对二维码生成前校正 Host/代理头。
 * - acceptsGzip / staticCacheControl / sendStaticContent — 静态与缓存。
 * - readBody / readBuffer — 读取请求体。
 *
 * Inward（本模块依赖/组装的关键符号）: node:zlib、node:path、security-options。
 *
 * Outward（谁在用/调用场景）: 几乎所有 server 路由模块。
 *
 * 不负责: 路由分发。
 */
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  isTrustedProxy,
  normalizeRemoteAddress,
  readSecurityOptions
} from './security-options.js';

const authoritySecurityOptions = readSecurityOptions();

export const DEFAULT_COMPRESSIBLE_EXTENSIONS = new Set([
  '.html',
  '.js',
  '.css',
  '.json',
  '.webmanifest',
  '.svg'
]);

function isPublicPairingRequestPayload(payload) {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    payload.requestId &&
    payload.codeLength &&
    payload.expiresAt &&
    !Object.prototype.hasOwnProperty.call(payload, 'code') &&
    (payload.pairingUrl || payload.qrUrl)
  );
}

export function sanitizeJsonPayload(payload) {
  if (!isPublicPairingRequestPayload(payload)) {
    return payload;
  }
  const {
    pairingUrl: _pairingUrl,
    qrUrl: _qrUrl,
    ...publicPayload
  } = payload;
  return publicPayload;
}

function pairingRequestPath(req) {
  return String(req?.url || '').split('?')[0];
}

function normalizedHostAddress(value) {
  const raw = String(value || '').trim().toLowerCase();
  const unwrapped = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  return normalizeRemoteAddress(unwrapped);
}

function loopbackAddress(value) {
  return ['localhost', '127.0.0.1', '::1'].includes(normalizedHostAddress(value));
}

function addressesEquivalent(left, right) {
  const a = normalizedHostAddress(left);
  const b = normalizedHostAddress(right);
  return a === b || (loopbackAddress(a) && loopbackAddress(b));
}

function authorityUrl(host, secure) {
  try {
    return new URL(`${secure ? 'https' : 'http'}://${String(host || '').trim()}`);
  } catch {
    return null;
  }
}

function safeSocketAuthority(req) {
  const secure = Boolean(req.socket?.encrypted);
  const address = normalizeRemoteAddress(req.socket?.localAddress || '') || '127.0.0.1';
  const host = address.includes(':') ? `[${address}]` : address;
  const fallbackPort = Number(process.env[secure ? 'HTTPS_PORT' : 'PORT'] || (secure ? 3443 : 3321));
  const port = Number(req.socket?.localPort || fallbackPort);
  return `${host}:${port}`;
}

function directAuthorityIsBound(req, host) {
  const secure = Boolean(req.socket?.encrypted);
  const parsed = authorityUrl(host, secure);
  if (!parsed) {
    return false;
  }
  const hostname = normalizedHostAddress(parsed.hostname);
  const localAddress = normalizeRemoteAddress(req.socket?.localAddress || '');
  const fallbackPort = Number(process.env[secure ? 'HTTPS_PORT' : 'PORT'] || (secure ? 3443 : 3321));
  const requestedPort = Number(parsed.port || (secure ? 443 : 80));
  const localPort = Number(req.socket?.localPort || fallbackPort);
  if (addressesEquivalent(hostname, localAddress) && requestedPort === localPort) {
    return true;
  }

  const origin = parsed.origin;
  if ((authoritySecurityOptions.configuredAllowedOrigins || []).includes(origin)) {
    return true;
  }

  const tlsServerName = normalizedHostAddress(req.socket?.servername || '');
  return secure && Boolean(tlsServerName) && tlsServerName === hostname;
}

export function hardenPairingRequestAuthority(req) {
  if (!['/api/pair/request', '/api/pair/terminal-request'].includes(pairingRequestPath(req))) {
    return;
  }
  const directRemote = req.socket?.remoteAddress || '';
  if (isTrustedProxy(directRemote, authoritySecurityOptions)) {
    return;
  }

  delete req.headers?.['x-forwarded-host'];
  delete req.headers?.['x-forwarded-proto'];
  delete req.headers?.['x-forwarded-port'];

  if (!directAuthorityIsBound(req, req.headers?.host)) {
    req.headers.host = safeSocketAuthority(req);
  }
}

export function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(sanitizeJsonPayload(payload)));
}

export function sendHtml(res, status, html) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(html);
}

export function htmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function acceptsGzip(req) {
  return String(req.headers['accept-encoding'] || '')
    .split(',')
    .some((value) => value.trim().toLowerCase().startsWith('gzip'));
}

export function staticCacheControl(ext, filePath = '') {
  if (ext === '.html') {
    return 'no-store';
  }
  const normalized = filePath.split(path.sep).join('/');
  if (normalized.includes('/assets/')) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=3600';
}

export function sendStaticContent(req, res, status, content, headers, ext, {
  compressibleExtensions = DEFAULT_COMPRESSIBLE_EXTENSIONS
} = {}) {
  let body = content;
  const nextHeaders = { ...headers };
  if (content.length >= 1024 && compressibleExtensions.has(ext) && acceptsGzip(req)) {
    body = gzipSync(content);
    nextHeaders['content-encoding'] = 'gzip';
    nextHeaders.vary = nextHeaders.vary ? `${nextHeaders.vary}, Accept-Encoding` : 'Accept-Encoding';
  }
  nextHeaders['content-length'] = body.length;
  res.writeHead(status, nextHeaders);
  res.end(body);
}

export function readBody(req, { maxBytes = 2 * 1024 * 1024 } = {}) {
  hardenPairingRequestAuthority(req);
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export function readBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) {
        return;
      }
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        req.resume();
        reject(new Error('Upload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}
