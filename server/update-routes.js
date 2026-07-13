/**
 * 更新相关 HTTP API：检查 GitHub Release、触发安装并读取后台进度。
 *
 * Keywords: update-api, github-release, install, progress
 *
 * Exports:
 * - createUpdateRouteHandler — 注入 updateService 后返回 /api/update/* handler。
 *
 * Inward（本模块依赖/组装的关键符号）: http-utils、update-service。
 *
 * Outward（谁在用/调用场景）: server/index.js 路由分发。
 */
import { readBody, sendJson } from './http-utils.js';

function sendUpdateError(res, error, fallback = 'Update operation failed') {
  sendJson(res, error.statusCode || 500, {
    error: error.message || fallback,
    code: error.code || null
  });
}

export function createUpdateRouteHandler({ updateService }) {
  if (!updateService) {
    throw new Error('createUpdateRouteHandler requires updateService');
  }

  return async function handleUpdateApi(req, res, url) {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/update/')) {
      return false;
    }

    if (method === 'GET' && pathname === '/api/update/status') {
      try {
        sendJson(res, 200, { success: true, update: await updateService.checkForUpdates() });
      } catch (error) {
        sendUpdateError(res, error, 'Failed to check updates');
      }
      return true;
    }

    if (method === 'GET' && pathname === '/api/update/progress') {
      try {
        sendJson(res, 200, { success: true, progress: await updateService.readProgress() });
      } catch (error) {
        sendUpdateError(res, error, 'Failed to read update progress');
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/update/apply') {
      const body = await readBody(req);
      try {
        sendJson(res, 202, { success: true, ...(await updateService.applyUpdate(body)) });
      } catch (error) {
        sendUpdateError(res, error, 'Failed to apply update');
      }
      return true;
    }

    sendJson(res, 404, { error: 'Update API route not found' });
    return true;
  };
}
