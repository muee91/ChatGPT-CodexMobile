/**
 * 测试 server/security-options.js：环境变量、安全来源、私网 CIDR、完全访问默认值与代理地址判断。
 *
 * Keywords: security-options, cidr, origin, proxy, danger-full-access, test
 *
 * Exports: 无导出，内含用例
 *
 * Inward: security-options.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clientRemoteAddress,
  envFlag,
  isPrivateRemoteAddress,
  isRequestTransportSecure,
  isTrustedProxy,
  readSecurityOptions,
  sameOriginAllowed
} from './security-options.js';

test('envFlag only enables explicit true-like values', () => {
  assert.equal(envFlag({ A: '1' }, 'A'), true);
  assert.equal(envFlag({ A: 'true' }, 'A'), true);
  assert.equal(envFlag({ A: 'yes' }, 'A'), true);
  assert.equal(envFlag({ A: 'on' }, 'A'), true);
  assert.equal(envFlag({ A: '0' }, 'A'), false);
  assert.equal(envFlag({}, 'A'), false);
});

test('isPrivateRemoteAddress recognizes LAN, loopback, and Tailscale CGNAT', () => {
  assert.equal(isPrivateRemoteAddress('127.0.0.1'), true);
  assert.equal(isPrivateRemoteAddress('::ffff:192.168.1.20'), true);
  assert.equal(isPrivateRemoteAddress('100.64.1.2'), true);
  assert.equal(isPrivateRemoteAddress('100.128.0.1'), false);
  assert.equal(isPrivateRemoteAddress('203.0.113.9'), false);
});

test('readSecurityOptions keeps danger full access available for private bridge by default', () => {
  const options = readSecurityOptions({});
  assert.equal(options.publicAccess, false);
  assert.equal(options.dangerFullAccessEnabled, true);
});

test('readSecurityOptions disables danger full access for public access unless explicitly enabled', () => {
  assert.equal(readSecurityOptions({ CODEXMOBILE_PUBLIC_ACCESS: '1' }).dangerFullAccessEnabled, false);
  assert.equal(readSecurityOptions({
    CODEXMOBILE_PUBLIC_ACCESS: '1',
    CODEXMOBILE_ENABLE_DANGER_FULL_ACCESS: '1'
  }).dangerFullAccessEnabled, true);
  assert.equal(readSecurityOptions({ CODEXMOBILE_ENABLE_DANGER_FULL_ACCESS: '0' }).dangerFullAccessEnabled, false);
});

test('readSecurityOptions exposes safe origins and explicit origins', () => {
  const options = readSecurityOptions({
    CODEXMOBILE_PUBLIC_URL: 'https://codex.example.com/mobile',
    CODEXMOBILE_ALLOWED_ORIGINS: 'https://extra.example.com',
    CODEXMOBILE_PRIVATE_CIDRS: '198.51.100.0/24'
  });
  assert.equal(options.publicAccess, false);
  assert.equal(options.allowRemotePairing, false);
  assert.equal(options.dangerFullAccessEnabled, true);
  assert.equal(options.legacyBearerEnabled, true);
  assert.equal(isPrivateRemoteAddress('198.51.100.7', options), true);
  assert.equal(sameOriginAllowed('capacitor://localhost', options), true);
  assert.equal(sameOriginAllowed('http://localhost', options), true);
  assert.equal(sameOriginAllowed('https://codex.example.com', options), true);
  assert.equal(sameOriginAllowed('https://extra.example.com', options), true);
  assert.equal(sameOriginAllowed('https://evil.example.com', options), false);
});

test('clientRemoteAddress trusts forwarded headers only from trusted proxies', () => {
  const req = {
    socket: { remoteAddress: '203.0.113.20' },
    headers: { 'x-forwarded-for': '192.168.1.8, 203.0.113.1' }
  };
  assert.equal(clientRemoteAddress(req, readSecurityOptions({})), '203.0.113.20');

  const proxied = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '198.51.100.22, 127.0.0.1' }
  };
  const options = readSecurityOptions({ CODEXMOBILE_TRUSTED_PROXIES: '127.0.0.1' });
  assert.equal(isTrustedProxy('127.0.0.1', options), true);
  assert.equal(clientRemoteAddress(proxied, options), '198.51.100.22');
});

test('isRequestTransportSecure accepts forwarded https only from trusted proxies', () => {
  assert.equal(isRequestTransportSecure({ socket: { encrypted: true }, headers: {} }, readSecurityOptions({})), true);
  assert.equal(
    isRequestTransportSecure({ socket: { remoteAddress: '203.0.113.20' }, headers: { 'x-forwarded-proto': 'https' } }, readSecurityOptions({ CODEXMOBILE_TRUSTED_PROXIES: '127.0.0.1' })),
    false
  );
  assert.equal(
    isRequestTransportSecure(
      { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-proto': 'https' } },
      readSecurityOptions({ CODEXMOBILE_TRUSTED_PROXIES: '127.0.0.1' })
    ),
    true
  );
});
