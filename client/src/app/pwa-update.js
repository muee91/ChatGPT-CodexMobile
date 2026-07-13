/**
 * PWA 前端资源更新检测：注册 service worker，并对比当前页面与最新 index.html 的资源指纹。
 *
 * Keywords: pwa, update, service-worker, assets, refresh
 *
 * Exports:
 * - assetSignatureFromHtml / assetSignatureFromDocument — 提取 Vite 构建资源签名。
 * - frontendAssetsChanged — 判断当前包与最新包是否不同。
 * - fetchLatestAssetSignature — 拉取最新 index.html 并生成签名。
 * - usePwaUpdate — React hook，暴露新版本提示状态与刷新动作。
 *
 * Inward: React hooks、浏览器 fetch / navigator.serviceWorker / DOM。
 *
 * Outward: App.jsx、pwa-update 单测。
 *
 * 不负责: 实际资源缓存策略；刷新后由浏览器重新加载最新包。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_CHECK_INTERVAL_MS = 60_000;
const ASSET_URL_PATTERN = /(?:src|href)=["']([^"']*\/assets\/[^"']+\.(?:js|css|webmanifest)(?:\?[^"']*)?)["']/gi;
const SERVICE_WORKER_PATH = '/codexmobile-sw.js';

function normalizeAssetUrl(value, baseHref = 'http://localhost/') {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const url = new URL(raw, baseHref);
    return `${url.pathname}${url.search}`;
  } catch {
    return raw.split('#')[0];
  }
}

function signatureFromAssetUrls(urls) {
  const normalized = [...new Set(urls.map((url) => normalizeAssetUrl(url)).filter(Boolean))].sort();
  return normalized.join('|');
}

export function assetSignatureFromHtml(html = '', baseHref = 'http://localhost/') {
  const assets = [];
  for (const match of String(html || '').matchAll(ASSET_URL_PATTERN)) {
    assets.push(normalizeAssetUrl(match[1], baseHref));
  }
  return signatureFromAssetUrls(assets);
}

export function assetSignatureFromDocument(doc = globalThis.document) {
  const nodes = Array.from(doc?.querySelectorAll?.('script[src], link[href]') || []);
  const assets = nodes
    .map((node) => node.getAttribute?.('src') || node.getAttribute?.('href') || '')
    .filter((value) => /\/assets\/.+\.(?:js|css|webmanifest)(?:\?|$)/i.test(value));
  return signatureFromAssetUrls(assets);
}

export function frontendAssetsChanged(currentSignature, latestSignature) {
  return Boolean(currentSignature && latestSignature && currentSignature !== latestSignature);
}

export async function fetchLatestAssetSignature({
  fetchImpl = globalThis.fetch,
  location = globalThis.location,
  cacheBust = Date.now()
} = {}) {
  if (typeof fetchImpl !== 'function') {
    return '';
  }
  const baseHref = location?.href || 'http://localhost/';
  const url = new URL('/', baseHref);
  url.searchParams.set('__codexmobile_pwa_check', String(cacheBust));
  const response = await fetchImpl(url.toString(), {
    cache: 'no-store',
    headers: { 'cache-control': 'no-cache' }
  });
  if (!response?.ok) {
    return '';
  }
  return assetSignatureFromHtml(await response.text(), url.toString());
}

function markWaitingWorker(registration) {
  const worker = registration?.waiting || registration?.installing;
  if (worker?.postMessage) {
    worker.postMessage({ type: 'SKIP_WAITING' });
  }
}

export function usePwaUpdate({
  win = globalThis.window,
  doc = globalThis.document,
  fetchImpl = globalThis.fetch,
  checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS
} = {}) {
  const [update, setUpdate] = useState({
    available: false,
    source: '',
    detectedAt: null
  });
  const currentSignatureRef = useRef('');
  const updateVisibleRef = useRef(false);

  const showUpdate = useCallback((source) => {
    if (updateVisibleRef.current) {
      return;
    }
    updateVisibleRef.current = true;
    setUpdate({
      available: true,
      source,
      detectedAt: new Date().toISOString()
    });
  }, []);

  const checkNow = useCallback(async () => {
    if (updateVisibleRef.current) {
      return false;
    }
    const currentSignature = currentSignatureRef.current || assetSignatureFromDocument(doc);
    if (!currentSignature) {
      return false;
    }
    try {
      const latestSignature = await fetchLatestAssetSignature({
        fetchImpl,
        location: win?.location
      });
      if (frontendAssetsChanged(currentSignature, latestSignature)) {
        showUpdate('assets');
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }, [doc, fetchImpl, showUpdate, win]);

  useEffect(() => {
    if (!win || !doc) {
      return undefined;
    }
    currentSignatureRef.current = assetSignatureFromDocument(doc);
    let cancelled = false;
    let timer = 0;
    let interval = 0;
    const serviceWorker = win.navigator?.serviceWorker;
    const hadControllerAtStart = Boolean(serviceWorker?.controller);

    const safeCheck = () => {
      if (!cancelled) {
        void checkNow();
      }
    };
    const onFocus = () => safeCheck();
    const onVisibilityChange = () => {
      if (doc.visibilityState === 'visible') {
        safeCheck();
      }
    };
    const onControllerChange = () => {
      if (hadControllerAtStart && serviceWorker?.controller) {
        showUpdate('service-worker');
      }
    };

    if (serviceWorker?.register) {
      serviceWorker.register(SERVICE_WORKER_PATH)
        .then((registration) => {
          if (cancelled) {
            return;
          }
          const updatePromise = registration.update?.();
          if (updatePromise?.catch) {
            updatePromise.catch(() => {});
          }
          registration.addEventListener?.('updatefound', () => {
            const installing = registration.installing;
            installing?.addEventListener?.('statechange', () => {
              if (!serviceWorker.controller) {
                return;
              }
              if (installing.state === 'installed' || installing.state === 'activated') {
                markWaitingWorker(registration);
                showUpdate('service-worker');
              }
            });
          });
        })
        .catch(() => {});
      serviceWorker.addEventListener?.('controllerchange', onControllerChange);
    }

    timer = win.setTimeout?.(safeCheck, 1500) || 0;
    interval = win.setInterval?.(safeCheck, checkIntervalMs) || 0;
    win.addEventListener?.('focus', onFocus);
    doc.addEventListener?.('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      if (timer) {
        win.clearTimeout?.(timer);
      }
      if (interval) {
        win.clearInterval?.(interval);
      }
      win.removeEventListener?.('focus', onFocus);
      doc.removeEventListener?.('visibilitychange', onVisibilityChange);
      serviceWorker?.removeEventListener?.('controllerchange', onControllerChange);
    };
  }, [checkIntervalMs, checkNow, doc, showUpdate, win]);

  const refresh = useCallback(() => {
    win?.location?.reload?.();
  }, [win]);

  const dismiss = useCallback(() => {
    setUpdate((current) => ({ ...current, available: false }));
  }, []);

  return {
    ...update,
    checkNow,
    refresh,
    dismiss
  };
}
