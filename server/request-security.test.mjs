/**
 * 测试 server/request-security.js：Cookie token、认证 Cookie、安全响应头与 CSRF 防护。
 *
 * Keywords: request-security, cookie, csrf, headers, test
 *
 * Exports: 无导出，内含用例
 *
 * Inward: request-security.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAuthCookie,
  clearAuthCookie,
  extractCookieToken,
  extractRequestToken,
  parseCookies,
  rejectSuspiciousFetchSite,
  rejectUnsafeOrigin,
  setSecurityHeaders
} from './request-security.js';

test('parseCookies parses auth cookie and ignores malformed percent-encoding', () => {
  assert.deepEqual(parseCookies('bad=%E0%A4%A; codexmobile_token=abc; theme=dark'), {
    codexmobile_token: 'abc',
    theme: 'dark'
  });
});

test('extractRequestToken prefers cookie and only uses Bearer when enabled', () => {
  const req = {
    url: '/ws?token=query-token',
    headers: {
      host: 'localhost:3321',
      cookie: 'codexmobile_token=cookie-token',
      authorization: 'Bearer bearer-token'
    }
  };
  assert.deepEqual(extractRequestToken(req), { token: 'cookie-token', source: 'cookie' });
  assert.deepEqual(
    extractRequestToken({ url: '/ws?token=query-token', headers: { host: 'localhost:3321' } }),
    { token: 'query-token', source: 'query' }
  );
  assert.deepEqual(extractRequestToken({ headers: { authorization: 'Bearer bearer-token' } }), { token: '', source: '' });
  assert.deepEqual(
    extractRequestToken({ headers: { authorization: 'Bearer bearer-token' } }, { allowBearer: true }),
    { token: 'bearer-token', source: 'bearer' }
  );
});

test('auth cookie helpers set HttpOnly browser attributes and can expire cookie', () => {
  const cookie = buildAuthCookie('token-value', { secure: true, maxAgeSeconds: 60 });
  assert.match(cookie, /codexmobile_token=token-value/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Max-Age=60/);
  assert.match(clearAuthCookie({ secure: false }), /Max-Age=0/);
  assert.equal(extractCookieToken({ headers: { cookie: 'x=1; codexmobile_token=abc' } }), 'abc');
});

test('origin and fetch-site guards reject cross-site state changes', () => {
  assert.equal(rejectUnsafeOrigin({
    method: 'POST',
    headers: { origin: 'https://evil.example.com' }
  }, {
    allowedOrigins: ['https://codex.example.com']
  }).statusCode, 403);
  assert.equal(rejectSuspiciousFetchSite({
    method: 'POST',
    headers: { 'sec-fetch-site': 'cross-site' }
  }).statusCode, 403);
});

test('setSecurityHeaders sets CSP and HSTS on secure requests', () => {
  const headers = {};
  const res = { setHeader: (key, value) => { headers[key.toLowerCase()] = value; } };
  setSecurityHeaders(res, { secure: true });
  assert.match(headers['strict-transport-security'], /max-age=15552000/);
  assert.match(headers['content-security-policy'], /default-src 'self'/);
  assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(headers['permissions-policy'], /camera=\(\)/);
});

test('setSecurityHeaders can opt into camera access for same-origin pairing flows', () => {
  const headers = {};
  const res = { setHeader: (key, value) => { headers[key.toLowerCase()] = value; } };
  setSecurityHeaders(res, { permissionsPolicy: 'camera=(self), geolocation=(), microphone=(self)' });
  assert.equal(headers['permissions-policy'], 'camera=(self), geolocation=(), microphone=(self)');
});

test('setSecurityHeaders can allow same-origin embedding for preview surfaces', () => {
  const headers = {};
  const res = { setHeader: (key, value) => { headers[key.toLowerCase()] = value; } };
  setSecurityHeaders(res, { frameAncestors: "'self'", frameOptions: 'SAMEORIGIN' });

  assert.match(headers['content-security-policy'], /frame-ancestors 'self'/);
  assert.equal(headers['x-frame-options'], 'SAMEORIGIN');
});
