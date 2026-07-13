/**
 * HTTP 通用工具：JSON/HTML 响应、gzip 静态、请求体与安全路径解析。
 *
 * Keywords: http-utils, gzip, readBody, sendJson
 *
 * Exports:
 * - DEFAULT_COMPRESSIBLE_EXTENSIONS — 可压缩静态扩展名集合。
 * - sendJson / sendHtml / htmlEscape — 响应与转义。
 * - acceptsGzip / staticCacheControl / sendStaticContent — 静态与缓存。
 * - readBody / readBuffer — 读取请求体。
 *
 * Inward（本模块依赖/组装的关键符号）: node:zlib、node:path。
 *
 * Outward（谁在用/调用场景）: 几乎所有 server 路由模块。
 *
 * 不负责: 路由分发。
 */
import path from 'node:path';
import { gzipSync } from 'node:zlib';

export const DEFAULT_COMPRESSIBLE_EXTENSIONS = new Set([
  '.html',
  '.js',
  '.css',
  '.json',
  '.webmanifest',
  '.svg'
]);

export function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
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
