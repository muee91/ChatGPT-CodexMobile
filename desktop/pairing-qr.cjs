const DEFAULT_PORT = 3321;

function isPrivateIpv4(value) {
  const parts = String(value || '').trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 100 && b >= 64 && b <= 127);
}

function lanIpv4Addresses(networks = {}) {
  return [...new Set(
    Object.values(networks)
      .flatMap((entries) => Array.isArray(entries) ? entries : [])
      .filter((entry) => entry?.family === 'IPv4' && !entry.internal && isPrivateIpv4(entry.address))
      .map((entry) => entry.address)
  )];
}

function preferredPairingAddress(networks = {}, defaultInterface = '') {
  const preferred = (networks[String(defaultInterface || '').trim()] || [])
    .find((entry) => entry?.family === 'IPv4' && !entry.internal && isPrivateIpv4(entry.address));
  return preferred?.address || lanIpv4Addresses(networks)[0] || '';
}

function pairingQrUrl({ host = '', port = DEFAULT_PORT, requestId = '', code = '', codeLength = 10 } = {}) {
  const address = String(host || '').trim();
  if (!isPrivateIpv4(address) || !requestId || !code) {
    return '';
  }
  const query = new URLSearchParams({
    requestId: String(requestId),
    code: String(code),
    codeLength: String(codeLength || 10)
  });
  return `http://${address}:${Number(port) || DEFAULT_PORT}/pair/qr?${query.toString()}`;
}

module.exports = {
  isPrivateIpv4,
  lanIpv4Addresses,
  preferredPairingAddress,
  pairingQrUrl
};
