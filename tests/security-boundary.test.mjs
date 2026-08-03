import assert from 'node:assert/strict';
import test from 'node:test';

import { createFileRouteHandler, isReadonlyLocalFileRoute } from '../server/file-routes.js';
import { extractRequestToken } from '../server/request-security.js';

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
