/**
 * 飞书 OAuth 与文档快捷入口相关的 HTTP 集成（状态页、回调、Pending 队列）。
 *
 * Keywords: feishu, oauth, lark, integration
 *
 * Exports:
 * - createFeishuIntegration — 返回处理器集合与路由挂载所需闭包。
 *
 * Inward（本模块依赖/组装的关键符号）: http-utils、crypto/fs/path 持久化 pending 状态。
 *
 * Outward（谁在用/调用场景）: server/index 注册 feishu 相关路径。
 *
 * 不负责: lark-cli 子命令实现。
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { htmlEscape, readBody, sendHtml, sendJson } from './http-utils.js';

const DEFAULT_DOCS_HOME_URL = 'https://docs.feishu.cn/';
const PENDING_STATE_MAX_AGE_MS = 15 * 60 * 1000;

export function createFeishuIntegration({
  statePath,
  appId = '',
  appSecret = '',
  redirectUri = '',
  publicUrl = '',
  docsHomeUrl = DEFAULT_DOCS_HOME_URL,
  getLarkDocsStatus,
  startLarkCliAuth,
  logoutLarkCli,
  requestOrigin,
  remoteAddress = () => '',
  fetchImpl = fetch
}) {
  if (!statePath || !getLarkDocsStatus || !requestOrigin) {
    throw new Error('createFeishuIntegration requires statePath, getLarkDocsStatus, and requestOrigin');
  }

  const feishuAppId = String(appId || '').trim();
  const feishuAppSecret = String(appSecret || '').trim();
  const fixedRedirectUri = String(redirectUri || '').trim();
  let feishuAuthState = { token: null, pendingStates: {} };

  async function loadState() {
    try {
      const raw = await fs.readFile(statePath, 'utf8');
      const parsed = JSON.parse(raw);
      feishuAuthState = {
        token: parsed?.token && typeof parsed.token === 'object' ? parsed.token : null,
        pendingStates: parsed?.pendingStates && typeof parsed.pendingStates === 'object' ? parsed.pendingStates : {}
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('[feishu] Failed to read auth state:', error.message);
      }
      feishuAuthState = { token: null, pendingStates: {} };
    }
  }

  async function saveState() {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(feishuAuthState, null, 2), 'utf8');
  }

  function cleanupPendingStates() {
    const now = Date.now();
    const nextStates = {};
    for (const [state, payload] of Object.entries(feishuAuthState.pendingStates || {})) {
      const createdAt = Number(payload?.createdAt || 0);
      if (createdAt && now - createdAt <= PENDING_STATE_MAX_AGE_MS) {
        nextStates[state] = payload;
      }
    }
    feishuAuthState.pendingStates = nextStates;
  }

  function configured() {
    return Boolean(feishuAppId && feishuAppSecret);
  }

  function tokenValid() {
    const expiresAt = Number(feishuAuthState.token?.expiresAt || 0);
    return Boolean(feishuAuthState.token?.accessToken && expiresAt && expiresAt > Date.now() + 60_000);
  }

  function userSummary() {
    const user = feishuAuthState.token?.user || {};
    const name = user.name || user.enName || user.email || user.enterpriseEmail || user.openId || '';
    return name ? {
      name,
      email: user.email || user.enterpriseEmail || '',
      openId: user.openId || ''
    } : null;
  }

  function redirectUriFor(req) {
    if (fixedRedirectUri) {
      return fixedRedirectUri;
    }
    const base = publicUrl || requestOrigin(req);
    return new URL('/api/feishu/auth/callback', base.endsWith('/') ? base : `${base}/`).toString();
  }

  async function publicDocsStatus(authenticated) {
    try {
      return await getLarkDocsStatus({ authenticated });
    } catch (error) {
      return {
        provider: 'feishu',
        integration: 'lark-cli',
        label: '飞书文档',
        configured: configured(),
        connected: authenticated ? tokenValid() : false,
        user: authenticated ? userSummary() : null,
        homeUrl: docsHomeUrl,
        cliInstalled: false,
        skillsInstalled: false,
        capabilities: [],
        codexEnabled: false,
        error: error.message || 'lark-cli status failed'
      };
    }
  }

  async function feishuJson(url, options = {}) {
    const response = await fetchImpl(url, {
      ...options,
      headers: {
        accept: 'application/json',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 1000) };
    }
    if (!response.ok || Number(data.code || 0) !== 0) {
      const error = new Error(data.msg || data.message || `Feishu API request failed: ${response.status}`);
      error.statusCode = response.status;
      error.response = data;
      throw error;
    }
    return data;
  }

  async function getAppAccessToken() {
    if (!configured()) {
      const error = new Error('Feishu app credentials are not configured');
      error.statusCode = 400;
      throw error;
    }
    const data = await feishuJson('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      body: JSON.stringify({
        app_id: feishuAppId,
        app_secret: feishuAppSecret
      })
    });
    return data.app_access_token;
  }

  async function exchangeCode(code) {
    const appAccessToken = await getAppAccessToken();
    const data = await feishuJson('https://open.feishu.cn/open-apis/authen/v1/access_token', {
      method: 'POST',
      headers: { authorization: `Bearer ${appAccessToken}` },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code
      })
    });
    const token = data.data || data;
    const now = Date.now();
    feishuAuthState.token = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token || '',
      expiresAt: now + Math.max(0, Number(token.expires_in || 0)) * 1000,
      refreshExpiresAt: token.refresh_expires_in ? now + Number(token.refresh_expires_in) * 1000 : 0,
      user: {
        name: token.name || '',
        enName: token.en_name || '',
        email: token.email || '',
        enterpriseEmail: token.enterprise_email || '',
        openId: token.open_id || '',
        unionId: token.union_id || '',
        userId: token.user_id || '',
        tenantKey: token.tenant_key || ''
      },
      updatedAt: new Date().toISOString()
    };
    await saveState();
    return feishuAuthState.token;
  }

  async function handleCallback(req, res, url) {
    const code = String(url.searchParams.get('code') || '').trim();
    const state = String(url.searchParams.get('state') || '').trim();
    const error = String(url.searchParams.get('error') || '').trim();
    cleanupPendingStates();
    const pending = state ? feishuAuthState.pendingStates[state] : null;
    if (!pending) {
      sendHtml(res, 400, '<!doctype html><meta charset="utf-8"><p>飞书授权已过期，请回到 CodexMobile 重新连接。</p>');
      return;
    }
    delete feishuAuthState.pendingStates[state];
    await saveState();
    if (error) {
      sendHtml(res, 400, `<!doctype html><meta charset="utf-8"><p>飞书授权失败：${htmlEscape(error)}</p>`);
      return;
    }
    if (!code) {
      sendHtml(res, 400, '<!doctype html><meta charset="utf-8"><p>飞书授权失败：没有收到授权码。</p>');
      return;
    }
    try {
      await exchangeCode(code);
      const backUrl = new URL('/', pending.redirectUri).toString();
      res.writeHead(302, { location: `${backUrl}?feishu=connected` });
      res.end();
    } catch (callbackError) {
      console.warn(`[feishu] OAuth callback failed remote=${remoteAddress(req)} message=${callbackError.message}`);
      sendHtml(res, 502, `<!doctype html><meta charset="utf-8"><p>飞书授权失败：${htmlEscape(callbackError.message)}</p>`);
    }
  }

  async function handleApi(req, res, url) {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/feishu/')) {
      return false;
    }

    if (method === 'GET' && pathname === '/api/feishu/status') {
      sendJson(res, 200, await publicDocsStatus(true));
      return true;
    }

    if (method === 'POST' && pathname === '/api/feishu/cli/auth/start') {
      try {
        const auth = await startLarkCliAuth();
        sendJson(res, 200, {
          success: true,
          ...auth,
          docs: await publicDocsStatus(true)
        });
      } catch (error) {
        const statusCode = error.statusCode || 502;
        console.warn(`[lark-cli] auth start failed remote=${remoteAddress(req)} message=${error.message}`);
        sendJson(res, statusCode, { error: error.message || '飞书 CLI 授权失败' });
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/feishu/cli/auth/logout') {
      try {
        await logoutLarkCli();
        sendJson(res, 200, {
          success: true,
          docs: await publicDocsStatus(true)
        });
      } catch (error) {
        const statusCode = error.statusCode || 502;
        console.warn(`[lark-cli] auth logout failed remote=${remoteAddress(req)} message=${error.message}`);
        sendJson(res, statusCode, { error: error.message || '断开飞书 CLI 授权失败' });
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/feishu/auth/start') {
      if (!configured()) {
        sendJson(res, 400, { error: 'Feishu app credentials are not configured' });
        return true;
      }
      cleanupPendingStates();
      const state = crypto.randomBytes(24).toString('base64url');
      const nextRedirectUri = redirectUriFor(req);
      feishuAuthState.pendingStates[state] = {
        createdAt: Date.now(),
        redirectUri: nextRedirectUri
      };
      await saveState();
      const authUrl = new URL('https://open.feishu.cn/open-apis/authen/v1/index');
      authUrl.searchParams.set('app_id', feishuAppId);
      authUrl.searchParams.set('redirect_uri', nextRedirectUri);
      authUrl.searchParams.set('state', state);
      sendJson(res, 200, {
        url: authUrl.toString(),
        redirectUri: nextRedirectUri
      });
      return true;
    }

    if (method === 'POST' && pathname === '/api/feishu/auth/logout') {
      feishuAuthState.token = null;
      await saveState();
      sendJson(res, 200, { success: true, ...(await publicDocsStatus(true)) });
      return true;
    }

    sendJson(res, 404, { error: 'Feishu API route not found' });
    return true;
  }

  return {
    handleApi,
    handleCallback,
    loadState,
    publicDocsStatus
  };
}
