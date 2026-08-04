/**
 * 远程图片代理：限制协议、固定已校验 DNS 结果、逐跳验证重定向并限制响应体大小。
 *
 * 私有网络策略：允许 RFC1918、IPv6 ULA 与 Tailscale CGNAT；禁止回环、链路本地、
 * 多播、未指定地址和常见云元数据端点。
 */
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export const REMOTE_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const REMOTE_IMAGE_TIMEOUT_MS = 15_000;
export const REMOTE_IMAGE_MAX_REDIRECTS = 5;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.azure.internal',
  'instance-data',
  'instance-data.ec2.internal'
]);
const BLOCKED_EXACT_IPV4 = new Set([
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200'
]);

function policyError(message, statusCode = 403) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = 'CODEXMOBILE_REMOTE_IMAGE_POLICY';
  return error;
}

function ipv4ToNumber(value) {
  const parts = String(value || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function ipv4InCidr(address, base, prefix) {
  const addressNumber = ipv4ToNumber(address);
  const baseNumber = ipv4ToNumber(base);
  if (addressNumber === null || baseNumber === null) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (addressNumber & mask) === (baseNumber & mask);
}

function normalizedAddress(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .split('%')[0];
}

export function isBlockedRemoteImageAddress(value) {
  const address = normalizedAddress(value);
  const mappedIpv4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) {
    return isBlockedRemoteImageAddress(mappedIpv4);
  }

  const family = net.isIP(address);
  if (family === 4) {
    return BLOCKED_EXACT_IPV4.has(address) ||
      ipv4InCidr(address, '0.0.0.0', 8) ||
      ipv4InCidr(address, '127.0.0.0', 8) ||
      ipv4InCidr(address, '169.254.0.0', 16) ||
      ipv4InCidr(address, '224.0.0.0', 4) ||
      ipv4InCidr(address, '240.0.0.0', 4);
  }
  if (family === 6) {
    if (address === '::' || address === '::1' || address.startsWith('::')) {
      return true;
    }
    const firstHextet = Number.parseInt(address.split(':')[0] || '0', 16);
    return (firstHextet & 0xffc0) === 0xfe80 || (firstHextet & 0xff00) === 0xff00;
  }
  return true;
}

export function isBlockedRemoteImageHostname(value) {
  const hostname = normalizedAddress(value).replace(/\.$/, '');
  return !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.metadata.google.internal');
}

function normalizeLookupRows(result) {
  const rows = Array.isArray(result) ? result : [result];
  return rows
    .map((entry) => typeof entry === 'string' ? { address: entry, family: net.isIP(entry) } : entry)
    .map((entry) => ({
      address: normalizedAddress(entry?.address),
      family: Number(entry?.family) || net.isIP(entry?.address)
    }))
    .filter((entry) => entry.address && [4, 6].includes(entry.family));
}

export async function validateRemoteImageTarget(input, {
  lookup = dns.lookup
} = {}) {
  let url;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(String(input || ''));
  } catch {
    throw policyError('Image URL is invalid', 400);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw policyError('Image URL must use http or https', 400);
  }
  if (url.username || url.password) {
    throw policyError('Image URL credentials are not allowed', 400);
  }
  if (isBlockedRemoteImageHostname(url.hostname)) {
    throw policyError('Remote image target is not allowed');
  }

  const literalFamily = net.isIP(normalizedAddress(url.hostname));
  const addresses = literalFamily
    ? [{ address: normalizedAddress(url.hostname), family: literalFamily }]
    : normalizeLookupRows(await lookup(url.hostname, { all: true, verbatim: true }));
  if (!addresses.length || addresses.some((entry) => isBlockedRemoteImageAddress(entry.address))) {
    throw policyError('Remote image target is not allowed');
  }
  return { url, addresses };
}

export function requestRemoteImageOnce(url, {
  addresses,
  maxBytes = REMOTE_IMAGE_MAX_BYTES,
  timeoutMs = REMOTE_IMAGE_TIMEOUT_MS
} = {}) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    let lookupIndex = 0;
    const pinnedLookup = (_hostname, options, callback) => {
      if (options?.all) {
        callback(null, addresses);
        return;
      }
      const entry = addresses[lookupIndex % addresses.length];
      lookupIndex += 1;
      callback(null, entry.address, entry.family);
    };
    const request = transport.request(url, {
      method: 'GET',
      lookup: pinnedLookup,
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'user-agent': 'CodexMobile/2.0 image proxy'
      }
    }, (response) => {
      const status = Number(response.statusCode || 0);
      const location = String(response.headers.location || '').trim();
      if (status >= 300 && status < 400 && location) {
        response.resume();
        resolve({ status, location, headers: response.headers, body: Buffer.alloc(0) });
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        resolve({ status, headers: response.headers, body: Buffer.alloc(0) });
        return;
      }

      const contentLength = Number(response.headers['content-length'] || 0);
      if (contentLength > maxBytes) {
        response.destroy();
        const error = new Error('Remote image is too large');
        error.statusCode = 413;
        reject(error);
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          const error = new Error('Remote image is too large');
          error.statusCode = 413;
          response.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        status,
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
      response.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => {
      const error = new Error('Remote image request timed out');
      error.name = 'AbortError';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end();
  });
}

export async function fetchRemoteImageBuffer(input, {
  lookup = dns.lookup,
  requestOnce = requestRemoteImageOnce,
  maxBytes = REMOTE_IMAGE_MAX_BYTES,
  timeoutMs = REMOTE_IMAGE_TIMEOUT_MS,
  maxRedirects = REMOTE_IMAGE_MAX_REDIRECTS
} = {}) {
  let currentUrl = input;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const target = await validateRemoteImageTarget(currentUrl, { lookup });
    const response = await requestOnce(target.url, {
      addresses: target.addresses,
      maxBytes,
      timeoutMs
    });
    const location = String(response.location || response.headers?.location || '').trim();
    if (response.status >= 300 && response.status < 400 && location) {
      if (redirectCount >= maxRedirects) {
        const error = new Error('Too many remote image redirects');
        error.statusCode = 502;
        throw error;
      }
      currentUrl = new URL(location, target.url);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      const error = new Error(`Remote image request failed: ${response.status || 502}`);
      error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
      throw error;
    }
    const contentType = String(response.headers?.['content-type'] || response.headers?.get?.('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!contentType.startsWith('image/')) {
      const error = new Error('Remote URL did not return an image');
      error.statusCode = 415;
      throw error;
    }
    const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body || []);
    if (body.length > maxBytes) {
      const error = new Error('Remote image is too large');
      error.statusCode = 413;
      throw error;
    }
    return { contentType, body, finalUrl: target.url.href };
  }
  throw policyError('Remote image request failed', 502);
}

function sendProxyJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

export async function proxyRemoteImage(_req, res, url, options = {}) {
  const rawUrl = String(url.searchParams.get('url') || '').trim();
  try {
    const result = await fetchRemoteImageBuffer(rawUrl, options);
    res.writeHead(200, {
      'content-type': result.contentType,
      'content-length': result.body.length,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff'
    });
    res.end(result.body);
  } catch (error) {
    const timeout = error?.name === 'AbortError';
    const status = timeout ? 504 : Number(error?.statusCode || 502);
    sendProxyJson(res, status, {
      error: timeout ? 'Remote image request timed out' : (error?.message || 'Remote image request failed')
    });
  }
}
