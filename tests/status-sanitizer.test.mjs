import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeJsonPayload } from '../server/http-utils.js';

test('unauthenticated status exposes only pairing bootstrap fields', () => {
  const sanitized = sanitizeJsonPayload({
    connected: true,
    hostName: 'workstation',
    port: 3321,
    pairing: { cwd: '/Users/example/project', commands: ['cd /Users/example/project', 'npm run pair'] },
    model: 'gpt-secret',
    skills: ['private-skill'],
    activeRuns: [{ id: 'run-1' }],
    desktopBridge: { connected: true },
    auth: { required: true, authenticated: false, trustedDevices: 4, canPair: true },
    security: { dangerFullAccessEnabled: true }
  });
  assert.deepEqual(sanitized, {
    connected: true,
    pairing: { commands: ['npm run pair'] },
    auth: { required: true, authenticated: false, canPair: true }
  });
});

test('unauthenticated status preserves a disabled pairing decision', () => {
  const sanitized = sanitizeJsonPayload({
    connected: true,
    auth: { required: true, authenticated: false, canPair: false }
  });
  assert.equal(sanitized.auth.canPair, false);
});

test('authenticated status remains unchanged', () => {
  const payload = {
    connected: true,
    model: 'gpt-5.5',
    auth: { required: true, authenticated: true, trustedDevices: 2, canPair: true }
  };
  assert.equal(sanitizeJsonPayload(payload), payload);
});
