const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3321);
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const STATUS_URL = `${SERVER_URL}/api/status`;

let mainWindow = null;
let tray = null;
let quitting = false;
let backendState = { healthy: false, busy: false, detail: '正在检查后端' };

function sourceRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.resolve(__dirname, '..');
}

function dataRoot() {
  const configured = String(process.env.CODEXMOBILE_DATA_ROOT || '').trim();
  if (configured) {
    return path.resolve(configured);
  }
  return app.isPackaged ? app.getPath('userData') : sourceRoot();
}

function runtimeDirectory() {
  return path.join(dataRoot(), '.codexmobile');
}

function appendDesktopLog(message) {
  try {
    fs.mkdirSync(runtimeDirectory(), { recursive: true });
    fs.appendFileSync(
      path.join(runtimeDirectory(), 'desktop.log'),
      `${new Date().toISOString()} ${String(message || '')}\n`
    );
  } catch {
    // Logging must never prevent the control window from opening.
  }
}

async function recordRendererHealth() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  const health = await mainWindow.webContents.executeJavaScript(`({
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    rootChildren: document.querySelector('#root')?.childElementCount || 0,
    bodyTextLength: (document.body?.innerText || '').trim().length
  })`, true);
  fs.mkdirSync(runtimeDirectory(), { recursive: true });
  fs.writeFileSync(
    path.join(runtimeDirectory(), 'desktop-runtime.json'),
    `${JSON.stringify({ ...health, checkedAt: new Date().toISOString() }, null, 2)}\n`
  );
  return health;
}

function controllerEnvironment() {
  const root = dataRoot();
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    CODEXMOBILE_DATA_ROOT: root,
    CODEXMOBILE_HOME: process.env.CODEXMOBILE_HOME || path.join(root, '.codexmobile', 'state')
  };
}

async function readBackendStatus() {
  try {
    const response = await fetch(STATUS_URL, { signal: AbortSignal.timeout(1800) });
    const status = await response.json();
    if (!response.ok || !status?.connected) {
      return null;
    }
    return status;
  } catch {
    return null;
  }
}

async function desktopCookieHeader() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return '';
  }
  const cookies = await mainWindow.webContents.session.cookies.get({ url: SERVER_URL });
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

async function desktopSessionIsAuthenticated() {
  const cookie = await desktopCookieHeader();
  if (!cookie) {
    return false;
  }
  try {
    const response = await fetch(STATUS_URL, {
      headers: { cookie },
      signal: AbortSignal.timeout(1800)
    });
    const status = await response.json();
    return Boolean(response.ok && status?.auth?.authenticated);
  } catch {
    return false;
  }
}

async function pairDesktopSession() {
  const response = await fetch(`${SERVER_URL}/api/pair/terminal-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceName: `CodexMobile Desktop (${process.platform})` }),
    signal: AbortSignal.timeout(5000)
  });
  const result = await response.json();
  if (!response.ok || !result?.requestId || !result?.code) {
    throw new Error(result?.error || '无法为桌面 App 创建本机配对凭据');
  }
  const pairedResponse = await fetch(`${SERVER_URL}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: result.requestId,
      code: result.code,
      deviceName: `CodexMobile Desktop (${process.platform})`
    }),
    signal: AbortSignal.timeout(5000)
  });
  const paired = await pairedResponse.json();
  if (!pairedResponse.ok || !paired?.token) {
    throw new Error(paired?.error || '桌面 App 本机配对失败');
  }
  const tokenExpiresAt = Date.parse(paired.device?.expiresAt || '');
  await mainWindow.webContents.session.cookies.set({
    url: SERVER_URL,
    name: 'codexmobile_token',
    value: paired.token,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    ...(Number.isFinite(tokenExpiresAt) ? { expirationDate: tokenExpiresAt / 1000 } : {})
  });
}

async function loadApplicationWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (!await desktopSessionIsAuthenticated()) {
    await pairDesktopSession();
  }
  await mainWindow.loadURL(SERVER_URL);
  const configuredServerChanged = await mainWindow.webContents.executeJavaScript(`(() => {
    const expected = ${JSON.stringify(SERVER_URL)};
    const key = 'codexmobile.serverUrl';
    const changed = localStorage.getItem(key) !== expected;
    localStorage.setItem(key, expected);
    localStorage.setItem('codexmobile.serverUrlHistory', JSON.stringify([expected]));
    return changed;
  })()`, true);
  if (configuredServerChanged) {
    await mainWindow.loadURL(SERVER_URL);
  }
  let health = await recordRendererHealth();
  if (!health?.rootChildren) {
    await mainWindow.loadURL(SERVER_URL);
    health = await recordRendererHealth();
  }
  appendDesktopLog(`renderer ready ${JSON.stringify(health)}`);
  if (!health?.rootChildren) {
    throw new Error('桌面页面已加载，但前端没有挂载。请打开后端日志重试。');
  }
  mainWindow.show();
  mainWindow.focus();
}

function runBackendController(command) {
  const script = path.join(sourceRoot(), 'scripts', 'backend-control.mjs');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, command], {
      cwd: dataRoot(),
      env: controllerEnvironment(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const output = `${stdout}\n${stderr}`.trim();
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(output || `后端控制器退出，code=${code}`));
    });
  });
}

function showStartupPage(message = '正在启动本地 Codex 服务...') {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const html = `<!doctype html>
    <meta charset="utf-8">
    <meta name="color-scheme" content="light dark">
    <title>CodexMobile</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111713;color:#eef4ef;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      main{max-width:560px;padding:48px;text-align:center}h1{font-size:30px;margin:0 0 12px}p{color:#aebbb1;white-space:pre-wrap}
      i{display:inline-block;width:9px;height:9px;margin-right:10px;border-radius:50%;background:#e6b85c;box-shadow:0 0 18px #e6b85c}
    </style>
    <main><h1>CodexMobile</h1><p><i></i>${String(message).replace(/[<>&]/g, '')}</p></main>`;
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => null);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }
  mainWindow.show();
  mainWindow.focus();
}

function updateNativeMenus() {
  const statusLabel = backendState.busy
    ? '后端处理中...'
    : backendState.healthy
      ? '后端运行中'
      : '后端未运行';
  if (tray) {
    tray.setToolTip(`CodexMobile - ${statusLabel}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: statusLabel, enabled: false },
      { type: 'separator' },
      { label: '打开 CodexMobile', click: showMainWindow },
      { label: '启动后端', enabled: !backendState.busy && !backendState.healthy, click: () => controlBackend('start') },
      { label: '重启后端', enabled: !backendState.busy, click: () => controlBackend('restart') },
      { label: '关闭后端', enabled: !backendState.busy && backendState.healthy, click: () => controlBackend('stop') },
      { label: '打开后端日志', click: openBackendLogs },
      { type: 'separator' },
      { label: '退出 CodexMobile', click: () => { quitting = true; app.quit(); } }
    ]));
  }
}

async function refreshBackendState({ loadWindow = false } = {}) {
  const status = await readBackendStatus();
  backendState = {
    healthy: Boolean(status),
    busy: backendState.busy,
    detail: status ? `${status.provider || 'Codex'} / ${status.model || 'default'}` : '后端未运行'
  };
  updateNativeMenus();
  if (loadWindow && status && mainWindow && !mainWindow.isDestroyed()) {
    await loadApplicationWindow();
  }
  return status;
}

async function controlBackend(command, { quiet = false } = {}) {
  if (backendState.busy) {
    return false;
  }
  backendState = { ...backendState, busy: true, detail: `正在${command}` };
  updateNativeMenus();
  if (command !== 'stop') {
    showStartupPage(command === 'restart' ? '正在重启本地 Codex 服务...' : '正在启动本地 Codex 服务...');
  }
  try {
    await runBackendController(command);
    const status = await refreshBackendState({ loadWindow: command !== 'stop' });
    if (command !== 'stop' && !status) {
      throw new Error('后端控制器已完成，但健康检查未通过');
    }
    if (command === 'stop') {
      showStartupPage('后端已关闭。可从菜单栏图标重新启动。');
    }
    return true;
  } catch (error) {
    backendState = { healthy: false, busy: false, detail: error.message };
    updateNativeMenus();
    showStartupPage(`后端启动失败\n${error.message}\n请从菜单栏打开后端日志。`);
    if (!quiet) {
      dialog.showErrorBox('CodexMobile 后端错误', error.message);
    }
    return false;
  } finally {
    backendState.busy = false;
    updateNativeMenus();
  }
}

function openBackendLogs() {
  const logPath = path.join(runtimeDirectory(), 'server.err.log');
  if (fs.existsSync(logPath)) {
    shell.showItemInFolder(logPath);
    return;
  }
  fs.mkdirSync(runtimeDirectory(), { recursive: true });
  shell.openPath(runtimeDirectory());
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: 'CodexMobile',
    width: 1320,
    height: 860,
    minWidth: 920,
    minHeight: 620,
    backgroundColor: '#111713',
    icon: path.join(sourceRoot(), 'client', 'public', 'codex-icon-512.png'),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(SERVER_URL)) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    appendDesktopLog(`renderer load failed code=${code} url=${url} description=${description}`);
  });
  mainWindow.webContents.on('console-message', (_event, details) => {
    const payload = details || {};
    appendDesktopLog(
      `renderer console level=${payload.level || ''} source=${payload.sourceId || ''}:${payload.lineNumber || ''} ${payload.message || ''}`
    );
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    appendDesktopLog(`renderer process gone ${JSON.stringify(details || {})}`);
  });
  showStartupPage();
}

function createTray() {
  const iconPath = path.join(sourceRoot(), 'client', 'public', 'codex-icon-180.png');
  const image = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  if (process.platform === 'darwin') {
    image.setTemplateImage(true);
  }
  tray = new Tray(image);
  tray.on('click', showMainWindow);
  updateNativeMenus();
}

function installApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'CodexMobile',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: '打开 CodexMobile', click: showMainWindow },
        { label: '重启后端', click: () => controlBackend('restart') },
        { label: '打开后端日志', click: openBackendLogs },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: '项目主页', click: () => shell.openExternal('https://github.com/muee91/ChatGPT-CodexMobile') }] }
  ]));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.whenReady().then(async () => {
    createMainWindow();
    createTray();
    installApplicationMenu();
    const status = await refreshBackendState({ loadWindow: true });
    if (!status) {
      await controlBackend('start', { quiet: true });
    }
    setInterval(() => refreshBackendState().catch(() => null), 5000).unref();
  });
}

app.on('activate', showMainWindow);
app.on('before-quit', () => {
  quitting = true;
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    quitting = true;
    app.quit();
  }
});

process.on('uncaughtException', (error) => {
  appendDesktopLog(`uncaughtException ${error?.stack || error}`);
});
process.on('unhandledRejection', (error) => {
  appendDesktopLog(`unhandledRejection ${error?.stack || error}`);
});
