/**
 * 浏览器 Web Push：VAPID 解码、能力检测、开通提示文案与服务 Worker 注册订阅。
 *
 * Keywords: web-push, VAPID, service-worker, PWA, iOS
 *
 * Exports:
 * - urlBase64ToUint8Array — 公钥转 Uint8Array。
 * - browserPushSupported — 环境是否具备 Push。
 * - notificationEnablementMessage — 向用户解释的开通条件文案。
 * - registerWebPush — 注册并上报订阅。
 *
 * Inward: fetch、navigator.serviceWorker（运行时）。
 *
 * Outward: useNotifications。
 */

export function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - String(value || '').length % 4) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

export function browserPushSupported(win = globalThis.window) {
  return Boolean(
    win?.navigator?.serviceWorker &&
    win?.PushManager &&
    win?.Notification &&
    typeof win.Notification.requestPermission === 'function'
  );
}

export function notificationEnablementMessage({
  supported = false,
  secureContext = false,
  standalone = false
} = {}) {
  if (!secureContext) {
    return 'iOS 后台通知需要 HTTPS 安全来源。请用 Tailscale HTTPS 地址重新添加到主屏幕。';
  }
  if (!standalone) {
    return 'iOS 后台通知需要从主屏幕图标打开 CodexMobile。';
  }
  if (!supported) {
    return '当前浏览器没有暴露 Web Push。请确认是 iOS 16.4+ 的主屏幕 PWA，并且不是普通 Safari 标签页。';
  }
  return '任务完成、失败或需要处理时会推送到系统通知。';
}

export async function registerWebPush({
  apiFetch,
  win = globalThis.window,
  serviceWorkerPath = '/codexmobile-sw.js'
} = {}) {
  if (typeof apiFetch !== 'function') {
    throw new Error('apiFetch is required');
  }
  if (!browserPushSupported(win)) {
    const error = new Error(notificationEnablementMessage({ supported: false }));
    error.code = 'push-unsupported';
    throw error;
  }
  const permission = await win.Notification.requestPermission();
  if (permission !== 'granted') {
    const error = new Error('浏览器没有授予通知权限。请在 iOS 设置或 Safari 网站设置里允许通知后再试。');
    error.code = 'permission-denied';
    error.permission = permission;
    throw error;
  }

  const registration = await win.navigator.serviceWorker.register(serviceWorkerPath);
  await win.navigator.serviceWorker.ready;
  const status = await apiFetch('/api/notifications/public-key');
  const publicKey = status.publicKey;
  if (!publicKey) {
    throw new Error('服务器没有返回 Web Push 公钥。');
  }
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }
  await apiFetch('/api/notifications/subscribe', {
    method: 'POST',
    body: { subscription: subscription.toJSON ? subscription.toJSON() : subscription }
  });
  return {
    permission,
    subscription
  };
}
