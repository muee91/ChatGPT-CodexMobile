/**
 * 测试 server/auth.js：一次性配对、可信设备 token、轮换、撤销与 WS 关闭。
 *
 * Keywords: auth, pairing, trusted-devices, token-rotation, test
 *
 * Exports: 无导出，内含用例
 *
 * Inward: auth.js、security-options.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createAuthController } from './auth.js';
import { readSecurityOptions } from './security-options.js';

async function tempAuth() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-auth-'));
  let nowMs = Date.parse('2026-05-10T00:00:00.000Z');
  const logs = [];
  const auth = createAuthController({
    dataDir,
    now: () => nowMs,
    logPairingCode: (entry) => logs.push(entry)
  });
  await auth.initializeAuth();
  return {
    auth,
    logs,
    advance(ms) {
      nowMs += ms;
    },
    security(overrides = {}) {
      return readSecurityOptions({ ...overrides });
    }
  };
}

test('LAN pairing request creates a console-only code and stores only a hash', async () => {
  const t = await tempAuth();
  const result = await t.auth.startPairingRequest({
    deviceName: 'iPhone / WeChat',
    userAgent: 'WeChat',
    remoteAddress: '192.168.1.23',
    securityOptions: t.security()
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, undefined);
  assert.match(result.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(result.codeLength, 10);
  assert.match(t.logs[0].code, /^[A-Z2-9]{10}$/);
  assert.equal(t.auth.getPendingPairingRequest(result.requestId).code, undefined);
  assert.match(t.auth.getPendingPairingRequest(result.requestId).codeHash, /^[a-f0-9]{64}$/);
});

test('pairing request can reveal the one-time code only when explicitly requested by local CLI flow', async () => {
  const t = await tempAuth();
  const result = await t.auth.startPairingRequest({
    deviceName: 'Terminal pairing',
    userAgent: 'CodexMobile CLI',
    remoteAddress: '127.0.0.1',
    revealCode: true,
    securityOptions: t.security({ CODEXMOBILE_PAIRING_REQUEST_COOLDOWN_MS: '1' })
  });
  assert.equal(result.ok, true);
  assert.match(result.code, /^[A-Z2-9]{10}$/);
  assert.equal(result.code, t.logs[0].code);
  assert.equal(t.auth.getPendingPairingRequest(result.requestId).code, undefined);
});

test('pairing request can return code for desktop QR without enabling code-only redemption from other devices', async () => {
  const t = await tempAuth();
  const result = await t.auth.startPairingRequest({
    deviceName: 'Android',
    userAgent: 'Android',
    remoteAddress: '192.168.1.23',
    returnCode: true,
    securityOptions: t.security({ CODEXMOBILE_PAIRING_REQUEST_COOLDOWN_MS: '1' })
  });
  assert.equal(result.ok, true);
  assert.match(result.code, /^[A-Z2-9]{10}$/);
  assert.equal(result.code, t.logs[0].code);

  const wrongRemote = await t.auth.completePairingRequest({
    code: result.code,
    deviceName: 'Other Android',
    remoteAddress: '192.168.1.24',
    securityOptions: t.security()
  });
  assert.equal(wrongRemote.ok, false);
  assert.equal(wrongRemote.statusCode, 403);
});

test('terminal pairing code can be entered on phone without a request id', async () => {
  const t = await tempAuth();
  const request = await t.auth.startPairingRequest({
    deviceName: 'Terminal pairing',
    userAgent: 'CodexMobile CLI',
    remoteAddress: '127.0.0.1',
    revealCode: true,
    securityOptions: t.security()
  });
  const paired = await t.auth.completePairingRequest({
    code: request.code,
    deviceName: 'iPhone',
    userAgent: 'Mobile Safari',
    remoteAddress: '192.168.1.23',
    securityOptions: t.security()
  });
  assert.equal(paired.ok, true);
  assert.equal(paired.device.name, 'iPhone');
  assert.equal(t.auth.getPendingPairingRequest(request.requestId), null);
});

test('phone pairing code can be entered without carrying request id on the same phone', async () => {
  const t = await tempAuth();
  const request = await t.auth.startPairingRequest({
    deviceName: 'iPhone / Safari',
    userAgent: 'Mobile Safari',
    remoteAddress: '192.168.1.23',
    securityOptions: t.security()
  });
  const paired = await t.auth.completePairingRequest({
    code: t.logs[0].code,
    deviceName: 'iPhone',
    remoteAddress: '192.168.1.23',
    securityOptions: t.security()
  });
  assert.equal(paired.ok, true);
  assert.equal(paired.device.name, 'iPhone');
  assert.equal(t.auth.getPendingPairingRequest(request.requestId), null);
});

test('terminal pairing code wins even when phone has a stale request id', async () => {
  const t = await tempAuth();
  const phoneRequest = await t.auth.startPairingRequest({
    deviceName: 'iPhone / Safari',
    userAgent: 'Mobile Safari',
    remoteAddress: '192.168.1.23',
    securityOptions: t.security({ CODEXMOBILE_PAIRING_REQUEST_COOLDOWN_MS: '1' })
  });
  const terminalRequest = await t.auth.startPairingRequest({
    deviceName: 'Terminal pairing',
    userAgent: 'CodexMobile CLI',
    remoteAddress: '127.0.0.1',
    revealCode: true,
    securityOptions: t.security({ CODEXMOBILE_PAIRING_REQUEST_COOLDOWN_MS: '1' })
  });
  const paired = await t.auth.completePairingRequest({
    requestId: phoneRequest.requestId,
    code: terminalRequest.code,
    deviceName: 'iPhone',
    remoteAddress: '192.168.1.23',
    securityOptions: t.security()
  });
  assert.equal(paired.ok, true);
  assert.equal(paired.device.name, 'iPhone');
  assert.equal(t.auth.getPendingPairingRequest(terminalRequest.requestId), null);
  assert.notEqual(t.auth.getPendingPairingRequest(phoneRequest.requestId), null);
});

test('WAN pairing request is rejected by default', async () => {
  const t = await tempAuth();
  const result = await t.auth.startPairingRequest({
    deviceName: 'Remote iPhone',
    userAgent: 'WeChat',
    remoteAddress: '203.0.113.9',
    securityOptions: t.security()
  });
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 403);
});

test('pairing completion requires same request, same remote, valid code, and unused request', async () => {
  const t = await tempAuth();
  const request = await t.auth.startPairingRequest({
    deviceName: 'iPhone / WeChat',
    userAgent: 'WeChat',
    remoteAddress: '192.168.1.23',
    securityOptions: t.security()
  });
  const code = t.logs[0].code;
  const wrongRemote = await t.auth.completePairingRequest({
    requestId: request.requestId,
    code,
    remoteAddress: '192.168.1.24',
    securityOptions: t.security()
  });
  assert.equal(wrongRemote.ok, false);
  assert.equal(wrongRemote.statusCode, 403);

  const paired = await t.auth.completePairingRequest({
    requestId: request.requestId,
    code,
    remoteAddress: '192.168.1.23',
    securityOptions: t.security()
  });
  assert.equal(paired.ok, true);
  assert.match(paired.token, /^[A-Za-z0-9_-]+$/);
  assert.equal(paired.device.name, 'iPhone');

  const reused = await t.auth.completePairingRequest({
    requestId: request.requestId,
    code,
    remoteAddress: '192.168.1.23',
    securityOptions: t.security()
  });
  assert.equal(reused.ok, false);
  assert.equal(reused.statusCode, 404);
});

test('token verifies, rotates, lists devices, and deleted devices disappear', async () => {
  const t = await tempAuth();
  const request = await t.auth.startPairingRequest({
    deviceName: 'iPhone',
    userAgent: 'WeChat',
    remoteAddress: '192.168.1.23',
    securityOptions: t.security({ CODEXMOBILE_TOKEN_TTL_MS: String(100 * 1000) })
  });
  const paired = await t.auth.completePairingRequest({
    requestId: request.requestId,
    code: t.logs[0].code,
    remoteAddress: '192.168.1.23',
    securityOptions: t.security({ CODEXMOBILE_TOKEN_TTL_MS: String(100 * 1000) })
  });
  t.advance(51 * 1000);
  const verified = await t.auth.verifyToken(paired.token, {
    remoteAddress: '198.51.100.7',
    userAgent: 'WeChat',
    securityOptions: t.security({ CODEXMOBILE_TOKEN_TTL_MS: String(100 * 1000) })
  });
  assert.equal(verified.ok, true);
  assert.match(verified.replacementToken, /^[A-Za-z0-9_-]+$/);
  assert.equal(t.auth.listDevices({ currentToken: verified.replacementToken })[0].current, true);

  const revoked = await t.auth.revokeDevice(paired.device.id);
  assert.equal(revoked.ok, true);
  assert.deepEqual(t.auth.listDevices({ currentToken: verified.replacementToken }), []);
  const afterRevoke = await t.auth.verifyToken(verified.replacementToken, {
    remoteAddress: '198.51.100.7',
    userAgent: 'WeChat',
    securityOptions: t.security()
  });
  assert.equal(afterRevoke.ok, false);
});

test('websocket tickets are single-use, short-lived, and bound to the requesting address', async () => {
  const t = await tempAuth();
  const request = await t.auth.startPairingRequest({
    deviceName: 'iPhone',
    remoteAddress: '192.168.1.23',
    securityOptions: t.security()
  });
  const paired = await t.auth.completePairingRequest({
    requestId: request.requestId,
    code: t.logs[0].code,
    remoteAddress: '192.168.1.23',
    securityOptions: t.security()
  });
  const verified = await t.auth.verifyToken(paired.token, {
    remoteAddress: '192.168.1.23',
    rotate: false,
    securityOptions: t.security()
  });
  const issued = t.auth.createWebSocketTicket({ tokenHash: verified.tokenHash, remoteAddress: '192.168.1.23' });

  assert.match(issued.ticket, /^[A-Za-z0-9_-]+$/);
  assert.equal(t.auth.consumeWebSocketTicket(issued.ticket, { remoteAddress: '192.168.1.24' }).ok, false);

  const next = t.auth.createWebSocketTicket({ tokenHash: verified.tokenHash, remoteAddress: '192.168.1.23' });
  assert.deepEqual(t.auth.consumeWebSocketTicket(next.ticket, { remoteAddress: '192.168.1.23' }), {
    ok: true,
    tokenHash: verified.tokenHash
  });
  assert.equal(t.auth.consumeWebSocketTicket(next.ticket, { remoteAddress: '192.168.1.23' }).ok, false);
});

test('revokeToken closes sockets registered to all tokens for the same device', async () => {
  const t = await tempAuth();
  const request = await t.auth.startPairingRequest({
    deviceName: 'iPhone',
    userAgent: 'WeChat',
    remoteAddress: '192.168.1.23',
    securityOptions: t.security({ CODEXMOBILE_TOKEN_TTL_MS: String(100 * 1000) })
  });
  const paired = await t.auth.completePairingRequest({
    requestId: request.requestId,
    code: t.logs[0].code,
    remoteAddress: '192.168.1.23',
    securityOptions: t.security({ CODEXMOBILE_TOKEN_TTL_MS: String(100 * 1000) })
  });
  t.advance(51 * 1000);
  const rotated = await t.auth.verifyToken(paired.token, {
    remoteAddress: '198.51.100.7',
    userAgent: 'WeChat',
    securityOptions: t.security({ CODEXMOBILE_TOKEN_TTL_MS: String(100 * 1000) })
  });
  const oldVerification = await t.auth.verifyToken(paired.token, {
    remoteAddress: '198.51.100.7',
    userAgent: 'WeChat',
    rotate: false,
    securityOptions: t.security({ CODEXMOBILE_TOKEN_TTL_MS: String(100 * 1000) })
  });
  const newVerification = await t.auth.verifyToken(rotated.replacementToken, {
    remoteAddress: '198.51.100.7',
    userAgent: 'WeChat',
    rotate: false,
    securityOptions: t.security({ CODEXMOBILE_TOKEN_TTL_MS: String(100 * 1000) })
  });
  const oldSocket = { closed: false, close() { this.closed = true; } };
  const newSocket = { closed: false, close() { this.closed = true; } };
  t.auth.registerSocket(oldVerification.tokenHash, oldSocket);
  t.auth.registerSocket(newVerification.tokenHash, newSocket);

  const revoked = await t.auth.revokeToken(paired.token);

  assert.equal(revoked.ok, true);
  assert.deepEqual(t.auth.listDevices({ currentToken: rotated.replacementToken }), []);
  assert.equal(oldSocket.closed, true);
  assert.equal(newSocket.closed, true);
});
