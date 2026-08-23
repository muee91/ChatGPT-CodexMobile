const assert = require('node:assert/strict');
const test = require('node:test');
const {
  pairingQrUrl,
  preferredPairingAddress
} = require('./pairing-qr.cjs');

test('desktop QR uses the default-route private interface before unrelated addresses', () => {
  const networks = {
    en0: [{ family: 'IPv4', internal: false, address: '172.20.10.2' }],
    utun4: [{ family: 'IPv4', internal: false, address: '100.92.1.4' }],
    bridge0: [{ family: 'IPv4', internal: false, address: '192.168.64.1' }]
  };

  const host = preferredPairingAddress(networks, 'en0');
  assert.equal(host, '172.20.10.2');
  assert.equal(
    pairingQrUrl({ host, requestId: 'request-1', code: 'ABCDE12345', codeLength: 10 }),
    'http://172.20.10.2:3321/pair/qr?requestId=request-1&code=ABCDE12345&codeLength=10'
  );
});
