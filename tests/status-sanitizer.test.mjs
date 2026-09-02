import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeJsonPayload } from '../server/http-utils.js';

function request({
  url = '/api/status',
  remoteAddress = '192.168.1.44',
  headers = {}
} = {}) {
  return { url, headers, socket: { remoteAddress } };
}

function statusPayload() {
  return {
    connected: true,
    hostName: 'workstation',
    port: 3321,
    pairing: { cwd: '/Users/example/project', commands: ['cd /Users/example/project', 'npm run pair'] },
    provider: 'codex',
    model: 'gpt-secret',
    syncedAt: '2026-08-04T12:00:00.000Z',
    skills: ['private-skill'],
    activeRuns: [{ id: 'run-1' }],
    desktopBridge: { connected: true },
    auth: { required: true, authenticated: false, trustedDevices: 4, canPair: true },
    security: { dangerFullAccessEnabled: true }
  };
}

test('remote unauthenticated status exposes discovery and generic pairing fields only', () => {
  const sanitized = sanitizeJsonPayload(statusPayload(), { request: request() });
  assert.deepEqual(sanitized, {
    connected: true,
    hostName: 'workstation',
    port: 3321,
    pairing: { commands: ['cd <CodexMobile 项目目录>', 'npm run pair'] },
    auth: { required: true, authenticated: false, canPair: true }
  });
});

test('direct loopback status preserves CLI and desktop diagnostics', () => {
  const payload = statusPayload();
  assert.equal(
    sanitizeJsonPayload(payload, { request: request({ remoteAddress: '127.0.0.1' }) }),
    payload
  );
  assert.equal(
    sanitizeJsonPayload(payload, { request: request({ remoteAddress: '::1' }) }),
    payload
  );
});

test('forwarded loopback requests do not inherit local diagnostic visibility', () => {
  const sanitized = sanitizeJsonPayload(statusPayload(), {
    request: request({
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '100.88.10.4' }
    })
  });
  assert.equal(sanitized.model, undefined);
  assert.equal(sanitized.hostName, 'workstation');
});

test('status-like payload on another route remains unchanged', () => {
  const payload = statusPayload();
  assert.equal(
    sanitizeJsonPayload(payload, { request: request({ url: '/api/other' }) }),
    payload
  );
});

test('remote status preserves a disabled pairing decision', () => {
  const payload = statusPayload();
  payload.auth.canPair = false;
  const sanitized = sanitizeJsonPayload(payload, { request: request() });
  assert.equal(sanitized.auth.canPair, false);
});

test('authenticated status remains unchanged', () => {
  const payload = {
    connected: true,
    model: 'gpt-5.5',
    auth: { required: true, authenticated: true, trustedDevices: 2, canPair: true }
  };
  assert.equal(sanitizeJsonPayload(payload, { request: request() }), payload);
});
