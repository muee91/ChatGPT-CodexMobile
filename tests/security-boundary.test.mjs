import assert from 'node:assert/strict';
import test from 'node:test';

import { createFileRouteHandler, isReadonlyLocalFileRoute } from '../server/file-routes.js';
import { sanitizeJsonPayload } from '../server/http-utils.js';
import { extractRequestToken, rejectUnsafeOrigin } from '../server/request-security.js';
import { readSecurityOptions, sameOriginAllowed } from '../server/security-options.js';

test('local-file reads never opt into the pre-auth route path', () => {
  assert.equal(isReadonlyLocalFileRoute('GET', '/api/local-file'), false);
  assert.equal(isReadonlyLocalFileRoute('GET', '/api/local-file/example.txt'), false);
  assert.equal(isReadonlyLocalFileRoute('GET', '/api/local-file-preview'), false);
});

test('authenticated file handler keeps local-file reads and previews working', async () => {
  const calls = [];
  const staticService = {
    async sendLocalFile() {
      calls.push('file');
    },
    async sendLocalFilePreview() {
      calls.push('preview');
    }
  };
  const handler = createFileRouteHandler({
    getProject: () => null,
    staticService,
    uploadRoot: '/tmp',
    maxUploadBytes: 1
  });

  assert.equal(await handler({ method: 'GET' }, {}, new URL('http://localhost/api/local-file?path=/tmp/a.txt')), true);
  assert.equal(await handler({ method: 'GET' }, {}, new URL('http://localhost/api/local-file-preview?path=/tmp/a.html')), true);
  assert.deepEqual(calls, ['file', 'preview']);
});

test('long-lived auth tokens are ignored in URL query parameters by default', () => {
  const result = extractRequestToken({
    url: '/api/status?token=secret-from-url',
    headers: { host: '192.168.1.2:3321' }
  });
  assert.deepEqual(result, { token: '', source: '' });
});

test('cookie remains primary and legacy bearer remains explicitly supported', () => {
  const cookie = extractRequestToken({
    url: '/api/status?token=query-token',
    headers: {
      cookie: 'codexmobile_token=cookie-token',
      authorization: 'Bearer bearer-token'
    }
  }, { allowBearer: true });
  assert.deepEqual(cookie, { token: 'cookie-token', source: 'cookie' });

  const bearer = extractRequestToken({
    url: '/api/status?token=query-token',
    headers: { authorization: 'Bearer bearer-token' }
  }, { allowBearer: true });
  assert.deepEqual(bearer, { token: 'bearer-token', source: 'bearer' });
});

test('query token support requires an explicit compatibility opt-in', () => {
  const result = extractRequestToken({
    url: '/api/status?token=temporary-compat-token',
    headers: { host: '127.0.0.1:3321' }
  }, { allowQuery: true });
  assert.deepEqual(result, { token: 'temporary-compat-token', source: 'query' });
});

test('runtime Host-derived origins cannot add an arbitrary public origin', () => {
  const base = readSecurityOptions({});
  const requestOptions = {
    ...base,
    allowedOrigins: [...base.allowedOrigins, 'https://evil.example']
  };

  assert.equal(sameOriginAllowed('https://evil.example', requestOptions), false);
});

test('localhost, literal LAN, local DNS, and Tailscale origins remain allowed', () => {
  const options = readSecurityOptions({});

  assert.equal(sameOriginAllowed('http://localhost:5173', options), true);
  assert.equal(sameOriginAllowed('http://192.168.1.10:3321', options), true);
  assert.equal(sameOriginAllowed('http://codex-workstation:3321', options), true);
  assert.equal(sameOriginAllowed('http://codex-workstation.local:3321', options), true);
  assert.equal(sameOriginAllowed('https://codex.example-tailnet.ts.net:3443', options), true);
});

test('configured public origins work while unconfigured public origins remain blocked', () => {
  const options = readSecurityOptions({
    CODEXMOBILE_PUBLIC_URL: 'https://codex.example',
    CODEXMOBILE_ALLOWED_ORIGINS: 'https://companion.example'
  });

  assert.equal(sameOriginAllowed('https://codex.example', options), true);
  assert.equal(sameOriginAllowed('https://companion.example', options), true);
  assert.equal(sameOriginAllowed('https://evil.example', options), false);
});

test('unsafe requests use the configured and private-network origin policy', () => {
  const base = readSecurityOptions({});
  const requestOptions = {
    ...base,
    allowedOrigins: [...base.allowedOrigins, 'https://evil.example']
  };

  assert.deepEqual(
    rejectUnsafeOrigin({ method: 'POST', headers: { origin: 'https://evil.example' } }, requestOptions),
    { statusCode: 403, error: 'Cross-origin request rejected' }
  );
  assert.equal(
    rejectUnsafeOrigin({ method: 'POST', headers: { origin: 'http://192.168.1.10:3321' } }, requestOptions),
    null
  );
});

test('phone pairing response excludes host-only QR links without changing terminal pairing', () => {
  const phoneResponse = sanitizeJsonPayload({
    requestId: 'request-1',
    codeLength: 10,
    expiresAt: '2026-08-04T12:00:00.000Z',
    requestCooldownSeconds: 30,
    pairingUrl: 'http://192.168.1.10:3321/pair?requestId=request-1&code=ABCDEFGH23',
    qrUrl: 'http://192.168.1.10:3321/pair/qr?requestId=request-1&code=ABCDEFGH23'
  });

  assert.deepEqual(phoneResponse, {
    requestId: 'request-1',
    codeLength: 10,
    expiresAt: '2026-08-04T12:00:00.000Z',
    requestCooldownSeconds: 30
  });

  const terminalResponse = {
    requestId: 'request-2',
    code: 'ABCDEFGH23',
    codeLength: 10,
    expiresAt: '2026-08-04T12:00:00.000Z',
    pairingUrl: 'http://127.0.0.1:3321/pair?requestId=request-2&code=ABCDEFGH23',
    qrUrl: 'http://127.0.0.1:3321/pair/qr?requestId=request-2&code=ABCDEFGH23'
  };
  assert.equal(sanitizeJsonPayload(terminalResponse), terminalResponse);
});
