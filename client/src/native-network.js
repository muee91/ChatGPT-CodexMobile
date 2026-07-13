/**
 * 安卓本机网络桥接：从原生层读取当前设备的私网 IPv4 地址。
 *
 * Keywords: capacitor, android, ipv4, local-network, native
 *
 * Exports:
 * - getNativeLocalIpv4Addresses — 优先从安卓原生层返回当前设备的私网 IPv4 列表。
 * - scanNativeLanServers — 优先由安卓原生层探测局域网内可用的 CodexMobile 服务。
 *
 * Inward: @capacitor/core。
 *
 * Outward: server-scan.js。
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

const LocalNetwork = registerPlugin('LocalNetwork');

function isIpv4Address(value) {
  const parts = String(value || '').trim().split('.');
  return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

export async function getNativeLocalIpv4Addresses() {
  if (Capacitor.getPlatform() !== 'android') {
    return [];
  }
  try {
    const result = await LocalNetwork.getLocalIpv4Addresses();
    return [...new Set((Array.isArray(result?.addresses) ? result.addresses : [])
      .map((value) => String(value || '').trim())
      .filter(isIpv4Address))];
  } catch {
    return [];
  }
}

export async function scanNativeLanServers({
  seedUrls = [],
  hostNumbers = [],
  timeoutMs = 900
} = {}) {
  if (Capacitor.getPlatform() !== 'android') {
    return null;
  }
  try {
    const result = await LocalNetwork.scanLanServers({
      seedUrls,
      hostNumbers,
      timeoutMs
    });
    return Array.isArray(result?.results) ? result.results : [];
  } catch {
    return null;
  }
}
