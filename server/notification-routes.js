/**
 * 浏览器推送订阅注册与 Web Push 触发 API。
 *
 * Keywords: notification-routes, push-api, web-push
 *
 * Exports:
 * - createNotificationRouteHandler — 需注入 pushService。
 *
 * Inward（本模块依赖/组装的关键符号）: http-utils、push-service。
 *
 * Outward（谁在用/调用场景）: server/index。
 *
 * 不负责: 业务启发式「何时推送」（由上层调用 pushService）。
 */
import { readBody, sendJson } from './http-utils.js';

export function createNotificationRouteHandler({
  pushService,
  remoteAddress = () => ''
}) {
  if (!pushService) {
    throw new Error('createNotificationRouteHandler requires pushService');
  }

  return async function handleNotificationApi(req, res, url) {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/notifications/')) {
      return false;
    }

    if (method === 'GET' && pathname === '/api/notifications/public-key') {
      sendJson(res, 200, await pushService.publicStatus());
      return true;
    }

    if (method === 'POST' && pathname === '/api/notifications/subscribe') {
      try {
        const body = await readBody(req);
        const result = await pushService.subscribe(body.subscription || body);
        await pushService.sendNotification({
          level: 'success',
          title: '完成通知已开启',
          body: 'CodexMobile 后台通知已经接通。',
          tag: 'codexmobile-notifications-enabled'
        });
        sendJson(res, 200, { success: true, ...result });
      } catch (error) {
        const statusCode = error.statusCode || 500;
        console.warn(`[push] subscribe failed remote=${remoteAddress(req)} message=${error.message}`);
        sendJson(res, statusCode, { error: error.message || 'Failed to subscribe push notification' });
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/notifications/unsubscribe') {
      try {
        const body = await readBody(req);
        const endpoint = body.endpoint || body.subscription?.endpoint;
        sendJson(res, 200, { success: true, ...(await pushService.unsubscribe(endpoint)) });
      } catch (error) {
        const statusCode = error.statusCode || 500;
        sendJson(res, statusCode, { error: error.message || 'Failed to unsubscribe push notification' });
      }
      return true;
    }

    sendJson(res, 404, { error: 'Notification API route not found' });
    return true;
  };
}
