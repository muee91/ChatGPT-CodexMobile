import assert from 'node:assert/strict';
import test from 'node:test';

import { createFileRouteHandler, isReadonlyLocalFileRoute } from '../server/file-routes.js';
import { pairingRequestUrlsForRequest, publicPairingRequestResponse } from '../server/pairing-response.js';
import { extractRequestToken } from '../server/request-security.js';
import {
  readSecurityOptions,
  requestCanonicalOrigin,
  requestOriginAllowed
} from '../server/security-options.js';

function requestFixture({ headers = {}, socket = {} } = {}) {
  return {
    headers,
    socket: {
      remoteAddress: '192.168.1.44',
      localAddress: '192.168.1.10',
      localPort: 3321,
      encrypted: false,
      ...socket
    }
  };
}

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

test('canonical origin ignores arbitrary Host and untrusted forwarded headers', () => {
  const options = readSecurityOptions({ PORT: '3321', HTTPS_PORT: '3443' });
  const request = requestFixture({
    headers: {
      host: 'evil.example',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https'
    }
  });

  assert.equal(requestCanonicalOrigin(request, options), 'http://192.168.1.10:3321');
  assert.equal(requestOriginAllowed('https://evil.example', request, options), false);
});

test('literal LAN and Tailscale host origins keep working', () => {
  const options = readSecurityOptions({ PORT: '3321', HTTPS_PORT: '3443' });
  const lanRequest = requestFixture({
    headers: {
      host: '192.168.1.10:3321',
      origin: 'http://192.168.1.10:3321'
    }
  });
  assert.equal(requestOriginAllowed(lanRequest.headers.origin, lanRequest, options), true);
  assert.equal(requestCanonicalOrigin(lanRequest, options), lanRequest.headers.origin);

  const tailscaleRequest = requestFixture({
    headers: {
      host: 'workstation.example-tailnet.ts.net:3321',
      origin: 'http://workstation.example-tailnet.ts.net:3321'
    },
    socket: {
      remoteAddress: '100.64.0.44',
      localAddress: '100.64.0.10'
    }
  });
  assert.equal(requestOriginAllowed(tailscaleRequest.headers.origin, tailscaleRequest, options), true);
  assert.equal(requestCanonicalOrigin(tailscaleRequest, options), tailscaleRequest.headers.origin);
});

test('forwarded host is used only from a trusted proxy and an allowed origin', () => {
  const options = readSecurityOptions({
    PORT: '3321',
    HTTPS_PORT: '3443',
    CODEXMOBILE_PUBLIC_URL: 'https://codex.example',
    CODEXMOBILE_TRUSTED_PROXIES: '10.0.0.0/8'
  });
  const request = requestFixture({
    headers: {
      host: '10.0.0.10:8080',
      'x-forwarded-host': 'codex.example',
      'x-forwarded-proto': 'https'
    },
    socket: {
      remoteAddress: '10.0.0.5',
      localAddress: '10.0.0.10',
      localPort: 8080
    }
  });

  assert.equal(requestCanonicalOrigin(request, options), 'https://codex.example');
  assert.equal(requestOriginAllowed('https://codex.example', request, options), true);
  assert.equal(requestOriginAllowed('https://evil.example', request, options), false);
});

test('phone pairing response excludes the code and host-only QR URLs', () => {
  const internal = {
    requestId: 'request-1',
    code: 'ABCDEFGH23',
    codeLength: 10,
    expiresAt: '2026-08-04T12:00:00.000Z',
    requestCooldownSeconds: 30
  };
  const hostUrls = pairingRequestUrlsForRequest(
    internal.requestId,
    internal.code,
    internal.codeLength,
    'http://192.168.1.10:3321'
  );
  const response = publicPairingRequestResponse({ ...internal, ...hostUrls });

  assert.deepEqual(response, {
    requestId: internal.requestId,
    codeLength: internal.codeLength,
    expiresAt: internal.expiresAt,
    requestCooldownSeconds: internal.requestCooldownSeconds
  });
  assert.equal('code' in response, false);
  assert.equal('pairingUrl' in response, false);
  assert.equal('qrUrl' in response, false);
  assert.match(hostUrls.qrUrl, /code=ABCDEFGH23/);
});
