import assert from 'node:assert/strict';
import test from 'node:test';

import { hardenPairingRequestAuthority } from '../server/http-utils.js';
import { readSecurityOptions } from '../server/security-options.js';

function pairingRequest({
  url = '/api/pair/request',
  host = '192.168.1.10:3321',
  remoteAddress = '192.168.1.44',
  localAddress = '192.168.1.10',
  localPort = 3321,
  encrypted = false,
  servername = '',
  forwardedHost = '',
  forwardedProto = ''
} = {}) {
  return {
    url,
    headers: {
      host,
      ...(forwardedHost ? { 'x-forwarded-host': forwardedHost } : {}),
      ...(forwardedProto ? { 'x-forwarded-proto': forwardedProto } : {})
    },
    socket: {
      remoteAddress,
      localAddress,
      localPort,
      encrypted,
      servername
    }
  };
}

test('matching direct LAN authority remains unchanged', () => {
  const req = pairingRequest();
  hardenPairingRequestAuthority(req, readSecurityOptions({}));

  assert.equal(req.headers.host, '192.168.1.10:3321');
});

test('spoofed public or different private Host is replaced by the listening address', () => {
  for (const host of ['evil.example', '192.168.1.99:3321', 'other-tailnet.ts.net:3321']) {
    const req = pairingRequest({ host });
    hardenPairingRequestAuthority(req, readSecurityOptions({}));
    assert.equal(req.headers.host, '192.168.1.10:3321', host);
  }
});

test('untrusted forwarded authority headers are removed before QR generation', () => {
  const options = readSecurityOptions({ CODEXMOBILE_TRUSTED_PROXIES: '10.0.0.0/8' });
  const req = pairingRequest({
    host: 'evil.example',
    forwardedHost: 'evil.example',
    forwardedProto: 'https'
  });

  hardenPairingRequestAuthority(req, options);

  assert.equal(req.headers.host, '192.168.1.10:3321');
  assert.equal('x-forwarded-host' in req.headers, false);
  assert.equal('x-forwarded-proto' in req.headers, false);
});

test('trusted proxy authority remains available for configured reverse proxies', () => {
  const options = readSecurityOptions({ CODEXMOBILE_TRUSTED_PROXIES: '10.0.0.0/8' });
  const req = pairingRequest({
    host: '10.0.0.10:8080',
    remoteAddress: '10.0.0.5',
    localAddress: '10.0.0.10',
    localPort: 8080,
    forwardedHost: 'codex.example',
    forwardedProto: 'https'
  });

  hardenPairingRequestAuthority(req, options);

  assert.equal(req.headers.host, '10.0.0.10:8080');
  assert.equal(req.headers['x-forwarded-host'], 'codex.example');
  assert.equal(req.headers['x-forwarded-proto'], 'https');
});

test('TLS SNI-bound host remains unchanged while non-pairing routes are untouched', () => {
  const tlsReq = pairingRequest({
    host: 'codex.example-tailnet.ts.net:3443',
    localAddress: '100.64.0.10',
    localPort: 3443,
    encrypted: true,
    servername: 'codex.example-tailnet.ts.net'
  });
  hardenPairingRequestAuthority(tlsReq, readSecurityOptions({}));
  assert.equal(tlsReq.headers.host, 'codex.example-tailnet.ts.net:3443');

  const unrelated = pairingRequest({
    url: '/api/chat',
    host: 'evil.example',
    forwardedHost: 'evil.example',
    forwardedProto: 'https'
  });
  hardenPairingRequestAuthority(unrelated, readSecurityOptions({}));
  assert.equal(unrelated.headers.host, 'evil.example');
  assert.equal(unrelated.headers['x-forwarded-host'], 'evil.example');
});
