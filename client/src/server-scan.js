/**
 * 局域网服务扫描：根据当前地址或本机私网地址推导同网段候选，并探测可连接的 CodexMobile 服务。
 *
 * Keywords: lan-scan, subnet, server-discovery, ipv4, pairing
 *
 * Exports:
 * - discoverLocalIpv4Addresses — 尝试拿到本机私网 IPv4。
 * - deriveServerScanSeeds — 生成扫描种子地址。
 * - buildSubnetScanCandidates — 把种子地址展开成同网段候选。
 * - scanLanServers — 扫描候选地址并返回可用服务。
 *
 * Inward: api.js 里的地址规范化；native-network；浏览器 fetch 与 RTCPeerConnection。
 *
 * Outward: PairingScreen.jsx、DrawerSettingsView.jsx。
 */

import { normalizeServerUrl } from './api.js';
import { getNativeLocalIpv4Addresses, scanNativeLanServers } from './native-network.js';

const DEFAULT_SERVER_PORT = '3321';
const DEFAULT_SCAN_TIMEOUT_MS = 900;
const DEFAULT_SCAN_CONCURRENCY = 24;
const DEFAULT_HOST_NUMBERS = Array.from({ length: 254 }, (_, index) => index + 1);

function isIpv4Host(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }
    const number = Number(part);
    return number >= 0 && number <= 255;
  });
}

function isPrivateIpv4Host(value) {
  if (!isIpv4Host(value)) {
    return false;
  }
  const [a, b] = String(value).split('.').map(Number);
  return a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31);
}

function normalizeUrlSeed(value, fallbackPort = DEFAULT_SERVER_PORT) {
  const normalized = normalizeServerUrl(value);
  if (!normalized) {
    return '';
  }
  try {
    const url = new URL(normalized);
    if (!isIpv4Host(url.hostname)) {
      return '';
    }
    if (!url.port) {
      url.port = fallbackPort;
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function pushSeed(list, value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!normalized || list.includes(normalized)) {
    return;
  }
  list.push(normalized);
}

function ipv4FromCandidateText(value) {
  const text = String(value || '');
  const matches = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
  return matches.filter(isPrivateIpv4Host);
}

export async function discoverLocalIpv4Addresses({
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
  timeoutMs = 1200
} = {}) {
  if (typeof RTCPeerConnectionImpl !== 'function') {
    return [];
  }
  return await new Promise((resolve) => {
    const addresses = new Set();
    let settled = false;
    let connection = null;

    function finish() {
      if (settled) {
        return;
      }
      settled = true;
      try {
        connection?.close?.();
      } catch {
        // ignore
      }
      resolve([...addresses]);
    }

    try {
      connection = new RTCPeerConnectionImpl({ iceServers: [] });
      connection.createDataChannel('codexmobile-scan');
      connection.onicecandidate = (event) => {
        for (const address of ipv4FromCandidateText(event?.candidate?.candidate || '')) {
          addresses.add(address);
        }
        if (!event?.candidate) {
          finish();
        }
      };
      connection.createOffer()
        .then((offer) => {
          for (const address of ipv4FromCandidateText(offer?.sdp || '')) {
            addresses.add(address);
          }
          return connection.setLocalDescription(offer);
        })
        .catch(() => finish());
      globalThis.setTimeout(finish, timeoutMs);
    } catch {
      finish();
    }
  });
}

export function deriveServerScanSeeds({
  serverInput = '',
  currentServerUrl = '',
  locationHref = '',
  localIpv4Addresses = [],
  defaultPort = DEFAULT_SERVER_PORT
} = {}) {
  const seeds = [];
  pushSeed(seeds, normalizeUrlSeed(serverInput, defaultPort));
  pushSeed(seeds, normalizeUrlSeed(currentServerUrl, defaultPort));
  pushSeed(seeds, normalizeUrlSeed(locationHref, defaultPort));
  for (const address of Array.isArray(localIpv4Addresses) ? localIpv4Addresses : []) {
    if (!isPrivateIpv4Host(address)) {
      continue;
    }
    pushSeed(seeds, `http://${address}:${defaultPort}`);
  }
  return seeds;
}

export function buildSubnetScanCandidates(seedUrls = [], hostNumbers = DEFAULT_HOST_NUMBERS) {
  const candidates = [];
  for (const seedUrl of Array.isArray(seedUrls) ? seedUrls : []) {
    try {
      const url = new URL(seedUrl);
      if (!isIpv4Host(url.hostname)) {
        continue;
      }
      const [a, b, c] = url.hostname.split('.');
      const protocol = url.protocol === 'https:' ? 'https:' : 'http:';
      const port = url.port || DEFAULT_SERVER_PORT;
      for (const hostNumber of hostNumbers) {
        if (!Number.isInteger(hostNumber) || hostNumber < 1 || hostNumber > 254) {
          continue;
        }
        candidates.push(`${protocol}//${a}.${b}.${c}.${hostNumber}:${port}`);
      }
    } catch {
      // ignore
    }
  }
  return [...new Set(candidates)];
}

function uniqueSeeds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function sortResults(results = []) {
  return [...results].sort((left, right) => String(left?.url || '').localeCompare(String(right?.url || '')));
}

async function probeLanServer(baseUrl, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_SCAN_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== 'function') {
    return null;
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? globalThis.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    for (const path of ['/api/discovery', '/api/status']) {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        signal: controller?.signal
      });
      if (!response?.ok) {
        if (path === '/api/discovery') {
          continue;
        }
        return null;
      }
      const data = await response.json().catch(() => null);
      if (!data?.connected) {
        return null;
      }
      return {
        url: baseUrl,
        hostName: String(data.hostName || '').trim(),
        port: Number(data.port || 0) || null,
        canPair: data.auth?.canPair !== false
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    if (timeout) {
      globalThis.clearTimeout(timeout);
    }
  }
}

export async function scanLanServers({
  serverInput = '',
  currentServerUrl = '',
  locationHref = globalThis.location?.href || '',
  localIpv4Addresses = null,
  getNativeLocalIpv4AddressesImpl = getNativeLocalIpv4Addresses,
  scanNativeLanServersImpl = scanNativeLanServers,
  fetchImpl = globalThis.fetch,
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
  timeoutMs = DEFAULT_SCAN_TIMEOUT_MS,
  concurrency = DEFAULT_SCAN_CONCURRENCY,
  defaultPort = DEFAULT_SERVER_PORT,
  hostNumbers = DEFAULT_HOST_NUMBERS,
  onProgress = null
} = {}) {
  const localAddresses = Array.isArray(localIpv4Addresses)
    ? localIpv4Addresses
    : await (async () => {
      const nativeAddresses = await getNativeLocalIpv4AddressesImpl().catch(() => []);
      if (nativeAddresses.length) {
        return [...new Set(nativeAddresses)];
      }
      return [
        ...new Set(
          await discoverLocalIpv4Addresses({ RTCPeerConnectionImpl })
        )
      ];
    })();
  const localSeeds = deriveServerScanSeeds({
    localIpv4Addresses: localAddresses,
    defaultPort
  });
  const fallbackSeeds = deriveServerScanSeeds({
    serverInput,
    currentServerUrl,
    locationHref,
    defaultPort
  }).filter((seed) => !localSeeds.includes(seed));
  const seeds = uniqueSeeds([...localSeeds, ...fallbackSeeds]);
  const diagnostics = {
    localAddresses,
    localSeeds,
    fallbackSeeds,
    native: {
      attempted: !Array.isArray(localIpv4Addresses),
      localResults: null,
      fallbackResults: null
    },
    js: {
      localCandidateCount: buildSubnetScanCandidates(localSeeds, hostNumbers).length,
      fallbackCandidateCount: buildSubnetScanCandidates(fallbackSeeds, hostNumbers).length
    },
    finalMode: ''
  };
  if (!seeds.length) {
    diagnostics.finalMode = 'no-seeds';
    return { seeds, results: [], diagnostics };
  }

  if (!Array.isArray(localIpv4Addresses)) {
    const nativeLocalResults = await scanNativeLanServersImpl({
      seedUrls: localSeeds,
      hostNumbers,
      timeoutMs
    }).catch(() => null);
    diagnostics.native.localResults = Array.isArray(nativeLocalResults) ? nativeLocalResults : null;
    if (Array.isArray(nativeLocalResults) && nativeLocalResults.length) {
      diagnostics.finalMode = 'native-local';
      return {
        seeds,
        results: sortResults(nativeLocalResults),
        diagnostics
      };
    }
    const nativeFallbackResults = await scanNativeLanServersImpl({
      seedUrls: fallbackSeeds,
      hostNumbers,
      timeoutMs
    }).catch(() => null);
    diagnostics.native.fallbackResults = Array.isArray(nativeFallbackResults) ? nativeFallbackResults : null;
    if (Array.isArray(nativeFallbackResults) && nativeFallbackResults.length) {
      diagnostics.finalMode = 'native-fallback';
      return {
        seeds,
        results: sortResults(nativeFallbackResults),
        diagnostics
      };
    }
  }

  async function scanSeedBatch(batchSeeds, progressOffset = 0) {
    const candidates = buildSubnetScanCandidates(batchSeeds, hostNumbers);
    if (!candidates.length) {
      return { results: [], completed: progressOffset, total: progressOffset };
    }
    const results = [];
    let cursor = 0;
    let completed = progressOffset;
    const total = progressOffset + candidates.length;

    async function worker() {
      while (cursor < candidates.length) {
        const index = cursor;
        cursor += 1;
        const candidate = candidates[index];
        const result = await probeLanServer(candidate, { fetchImpl, timeoutMs });
        completed += 1;
        onProgress?.({ completed, total, current: candidate });
        if (result) {
          results.push(result);
        }
      }
    }

    const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, candidates.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return { results, completed, total };
  }

  const localScan = await scanSeedBatch(localSeeds, 0);
  if (localScan.results.length || !fallbackSeeds.length) {
    diagnostics.finalMode = localScan.results.length ? 'js-local' : 'js-local-empty';
    return {
      seeds,
      results: sortResults(localScan.results),
      diagnostics
    };
  }

  const fallbackScan = await scanSeedBatch(fallbackSeeds, localScan.completed);
  diagnostics.finalMode = fallbackScan.results.length ? 'js-fallback' : 'js-fallback-empty';
  return {
    seeds,
    results: sortResults(fallbackScan.results),
    diagnostics
  };
}
