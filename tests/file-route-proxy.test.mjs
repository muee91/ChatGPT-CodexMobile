import assert from 'node:assert/strict';
import test from 'node:test';

import { createFileRouteHandler } from '../server/file-routes.js';

test('remote-image route uses the guarded proxy instead of the legacy static fetcher', async () => {
  const calls = [];
  const handler = createFileRouteHandler({
    getProject: () => null,
    staticService: {
      async sendRemoteImage() {
        throw new Error('legacy remote image fetcher must not be called');
      }
    },
    proxyRemoteImage: async (_req, _res, url) => {
      calls.push(url.searchParams.get('url'));
    },
    uploadRoot: '/tmp',
    maxUploadBytes: 1
  });

  const handled = await handler(
    { method: 'GET' },
    {},
    new URL('http://localhost/api/remote-image?url=http%3A%2F%2F192.168.1.44%2Fframe.jpg')
  );

  assert.equal(handled, true);
  assert.deepEqual(calls, ['http://192.168.1.44/frame.jpg']);
});
