import assert from 'node:assert/strict';
import test from 'node:test';

import {
  configuredRemoteImageLoopbackOrigins,
  fetchRemoteImageBuffer,
  isBlockedRemoteImageAddress,
  validateRemoteImageTarget
} from '../server/remote-image-proxy.js';

test('blocks loopback, link-local, metadata, multicast, and unspecified targets by default', () => {
  for (const address of [
    '127.0.0.1',
    '169.254.169.254',
    '169.254.170.2',
    '100.100.100.200',
    '0.0.0.0',
    '224.0.0.1',
    '::',
    '::1',
    'fe80::1',
    'ff02::1'
  ]) {
    assert.equal(isBlockedRemoteImageAddress(address), true, address);
  }
});

test('allows LAN, IPv6 ULA, public, and Tailscale addresses', () => {
  for (const address of ['192.168.1.8', '10.0.0.5', '172.20.1.3', 'fd7a:115c:a1e0::1', '100.64.1.9', '8.8.8.8']) {
    assert.equal(isBlockedRemoteImageAddress(address), false, address);
  }
});

test('allows the current CodexMobile loopback origin without opening other ports', async () => {
  const allowed = configuredRemoteImageLoopbackOrigins({ PORT: '3321', HTTPS_PORT: '3443' });
  const target = await validateRemoteImageTarget('http://127.0.0.1:3321/generated/example.png', {
    allowedLoopbackOrigins: allowed
  });
  assert.equal(target.url.origin, 'http://127.0.0.1:3321');

  await assert.rejects(
    validateRemoteImageTarget('http://127.0.0.1:9999/example.png', {
      allowedLoopbackOrigins: allowed
    }),
    /not allowed/
  );
});

test('allows an explicitly configured local image service origin', async () => {
  const allowed = configuredRemoteImageLoopbackOrigins({
    PORT: '3321',
    HTTPS_PORT: '3443',
    CODEXMOBILE_IMAGE_BASE_URL: 'http://localhost:8317/v1'
  });
  const target = await validateRemoteImageTarget('http://localhost:8317/images/result.png', {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    allowedLoopbackOrigins: allowed
  });
  assert.equal(target.url.origin, 'http://localhost:8317');
});

test('metadata remains blocked even when its origin is listed', async () => {
  await assert.rejects(
    validateRemoteImageTarget('http://169.254.169.254/latest/meta-data', {
      allowedLoopbackOrigins: ['http://169.254.169.254']
    }),
    /not allowed/
  );
});

test('rejects hostnames resolving to loopback unless explicitly configured', async () => {
  await assert.rejects(
    validateRemoteImageTarget('http://camera.lan/frame.jpg', {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }]
    }),
    /not allowed/
  );
});

test('accepts hostnames resolving to LAN and Tailscale addresses', async () => {
  const lan = await validateRemoteImageTarget('http://camera.lan/frame.jpg', {
    lookup: async () => [{ address: '192.168.1.44', family: 4 }]
  });
  assert.equal(lan.addresses[0].address, '192.168.1.44');

  const tailnet = await validateRemoteImageTarget('https://camera.tailnet.ts.net/frame.jpg', {
    lookup: async () => [{ address: '100.88.10.4', family: 4 }]
  });
  assert.equal(tailnet.addresses[0].address, '100.88.10.4');
});

test('rejects credentials embedded in remote image URLs', async () => {
  await assert.rejects(
    validateRemoteImageTarget('http://user:pass@192.168.1.44/frame.jpg'),
    /credentials/
  );
});

test('revalidates redirects and blocks a redirect to metadata', async () => {
  let calls = 0;
  await assert.rejects(
    fetchRemoteImageBuffer('https://images.example/start', {
      lookup: async () => [{ address: '203.0.113.10', family: 4 }],
      requestOnce: async () => {
        calls += 1;
        return {
          status: 302,
          location: 'http://169.254.169.254/latest/meta-data',
          headers: {},
          body: Buffer.alloc(0)
        };
      }
    }),
    /not allowed/
  );
  assert.equal(calls, 1);
});

test('preserves redirects to an allowed LAN image target', async () => {
  const requestedHosts = [];
  const result = await fetchRemoteImageBuffer('https://images.example/start', {
    lookup: async (hostname) => [{
      address: hostname === 'images.example' ? '203.0.113.10' : '192.168.1.44',
      family: 4
    }],
    requestOnce: async (url) => {
      requestedHosts.push(url.hostname);
      if (url.hostname === 'images.example') {
        return {
          status: 302,
          location: 'http://camera.lan/frame.jpg',
          headers: {},
          body: Buffer.alloc(0)
        };
      }
      return {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
        body: Buffer.from([1, 2, 3])
      };
    }
  });
  assert.deepEqual(requestedHosts, ['images.example', 'camera.lan']);
  assert.equal(result.contentType, 'image/jpeg');
  assert.deepEqual([...result.body], [1, 2, 3]);
});
