/**
 * 远程图片代理：限制协议、固定已校验 DNS 结果、逐跳验证重定向并限制响应体大小。
 *
 * 私有网络策略：允许 RFC1918、IPv6 ULA 与 Tailscale CGNAT；禁止云元数据、
 * 链路本地、多播和未指定地址。回环目标仅允许当前 CodexMobile 服务或显式配置来源。
 */
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export const REMOTE_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const REMOTE_IMAGE_TIMEOUT_MS = 15_000;
export const REMOTE_IMAGE_MAX_REDIRECTS = 5;

const HARD_BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.azure.internal',
  'instance-data',
  'instance-data.ec2.internal'
]);
const LOOPBACK_HOSTNAMES = new Set(['localhost']);
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

function normalizedHostname(value) {
  return normalizedAddress(value).replace(/\.$/, '');
}

function originFromValue(value) {
  try {
    return new URL(String(value || '').trim()).origin;
  } catch {
    return '';
  }
}

function configuredOriginsFromEnv(env = process.env) {
  const port = Number(env.PORT || 3321);
  const httpsPort = Number(env.HTTPS_PORT || 3443);
  const values = [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
    `https://127.0.0.1:${httpsPort}`,
    `https://localhost:${httpsPort}`,
    `https://[::1]:${httpsPort}`,
    env.CODEXMOBILE_IMAGE_BASE_URL,
    ...String(env.CODEXMOBILE_REMOTE_IMAGE_ALLOWED_ORIGINS || '')
      .split(',')
      .map((item) => item.trim())
  ];
  return [...new Set(values.map(originFromValue).filter(Boolean))];
}

export function configuredRemoteImageLoopbackOrigins(env = process.env) {
  return configuredOriginsFromEnv(env);
}

export function isLoopbackRemoteImageAddress(value) {
  const address = normalizedAddress(value);
  const mappedIpv4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) {
    return isLoopbackRemoteImageAddress(mappedIpv4);
  }
  if (net.isIP(address) === 4) {
    return ipv4InCidr(address, '127.0.0.0', 8);
  }
  return address === '::1';
}

export function isHardBlockedRemoteImageAddress(value) {
  const address = normalizedAddress(value);
  const mappedIpv4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) {
    return isHardBlockedRemoteImageAddress(mappedIpv4);
  }

  const family = net.isIP(address);
  if (family === 4) {
    return BLOCKED_EXACT_IPV4.has(address) ||
      ipv4InCidr(address, '0.0.0.0', 8) ||
      ipv4InCidr(address, '169.254.0.0', 16) ||
      ipv4InCidr(address, '224.0.0.0', 4) ||
      ipv4InCidr(address, '240.0.0.0', 4);
  }
  if (family === 6) {
    if (address === '::' || (address.startsWith('::') && address !== '::1')) {
      return true;
    }
    const firstHextet = Number.parseInt(address.split(':')[0] || '0', 16);
    return (firstHextet & 0xffc0) === 0xfe80 || (firstHextet & 0xff00) === 0xff00;
  }
  return true;
}

export function isBlockedRemoteImageAddress(value) {
  return isLoopbackRemoteImageAddress(value) || isHardBlockedRemoteImageAddress(value);
}

function isHardBlockedRemoteImageHostname(value) {
  const hostname = normalizedHostname(value);
  return !hostname ||
    HARD_BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.metadata.google.internal');
}

export function isBlockedRemoteImageHostname(value) {
  const hostname = normalizedHostname(value);
  return isHardBlockedRemoteImageHostname(hostname) ||
    LOOPBACK_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost');
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

function normalizedAllowedOrigins(values = configuredRemoteImageLoopbackOrigins()) {
  return new Set((Array.isArray(values) ? values : [values]).map(originFromValue).filter(Boolean));
}

export async function validateRemoteImageTarget(input, {
  lookup = dns.lookup,
  allowedLoopbackOrigins = configuredRemoteImageLoopbackOrigins()
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

  const hostname = normalizedHostname(url.hostname);
  const loopbackAllowed = normalizedAllowedOrigins(allowedLoopbackOrigins).has(url.origin);
  if (isHardBlockedRemoteImageHostname(hostname)) {
    throw policyError('Remote image target is not allowed');
  }
  if ((LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) && !loopbackAllowed) {
    throw policyError('Remote image target is not allowed');
  }

  const literalFamily = net.isIP(normalizedAddress(url.hostname));
  const addresses = literalFamily
    ? [{ address: normalizedAddress(url.hostname), family: literalFamily }]
    : normalizeLookupRows(await lookup(url.hostname, { all: true, verbatim: true }));
  if (!addresses.length || addresses.some((entry) => isHardBlockedRemoteImageAddress(entry.address))) {
    throw policyError('Remote image target is not allowed');
  }
  if (addresses.some((entry) => isLoopbackRemoteImageAddress(entry.address)) && !loopbackAllowed) {
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
      autoSelectFamily: addresses.length > 1,
      autoSelectFamilyAttemptTimeout: 250,
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
  maxRedirects = REMOTE_IMAGE_MAX_REDIRECTS,
  allowedLoopbackOrigins = configuredRemoteImageLoopbackOrigins()
} = {}) {
  let currentUrl = input;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const target = await validateRemoteImageTarget(currentUrl, { lookup, allowedLoopbackOrigins });
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
