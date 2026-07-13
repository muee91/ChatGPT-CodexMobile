/**
 * 顶栏连接态文案：WebSocket / 桌面桥 / 选中会话与运行时的组合展示标签。
 *
 * Keywords: topbar, connection, bridge, runtime, websocket
 *
 * Exports:
 * - bridgeConnectionLabel — 返回 label、className、description。
 *
 * Inward: 无外部模块；纯函数根据连接与 runtime 派生文案。
 *
 * Outward: TopBar、topbar-status 单测、状态点展示。
 */

const CONNECTION_STATUS = {
  connected: { label: '已连接', className: 'is-connected', description: 'CodexMobile 服务已连接。' },
  connecting: { label: '连接中', className: 'is-connecting', description: '正在连接 CodexMobile 服务。' },
  disconnected: { label: '未连接', className: 'is-disconnected', description: 'CodexMobile 服务未连接。' }
};

function runtimeSource(runtime) {
  return String(runtime?.source || '').trim();
}

function isDesktopRuntime(runtime) {
  const source = runtimeSource(runtime);
  return source === 'desktop-ipc';
}

function isHeadlessRuntime(runtime) {
  const source = runtimeSource(runtime);
  return source === 'headless-local' || source === 'background' || source === 'local';
}

function runtimeClassName(runtime, stateClass = 'is-running') {
  const sourceClass = isDesktopRuntime(runtime)
    ? 'is-thread-ipc'
    : isHeadlessRuntime(runtime)
      ? 'is-headless'
      : 'is-route-pending';
  return `is-connected ${stateClass} ${sourceClass}`;
}

function runtimeDescription(runtime, fallback) {
  const detail = String(runtime?.detail || '').trim();
  if (detail) {
    return detail;
  }
  if (isDesktopRuntime(runtime)) {
    return '当前线程来自桌面端 live mirror，移动端只同步桌面运行过程。';
  }
  if (isHeadlessRuntime(runtime)) {
    return '当前线程正在后台 Codex 执行，桌面端没有接管这个运行。';
  }
  return fallback;
}

function runtimeChannelLabel(runtime, status) {
  if (status === 'queued') {
    if (runtimeSource(runtime) === 'local-optimistic') {
      return runtime?.label || '消息发送中';
    }
    if (isDesktopRuntime(runtime)) {
      return '桌面端排队中';
    }
    if (isHeadlessRuntime(runtime)) {
      return '后台排队中';
    }
    return '任务排队中';
  }
  if (status === 'failed') {
    if (isDesktopRuntime(runtime)) {
      return '桌面端运行失败';
    }
    if (isHeadlessRuntime(runtime)) {
      return '后台 Codex 运行失败';
    }
    return '运行失败';
  }
  if (isDesktopRuntime(runtime)) {
    return '桌面端运行中';
  }
  if (isHeadlessRuntime(runtime)) {
    return '正在后台运行 Codex';
  }
  return '正在运行 Codex';
}

export function bridgeConnectionLabel(connectionState, desktopBridge, { selectedSession = null, selectedRuntime = null } = {}) {
  if (connectionState !== 'connected') {
    return CONNECTION_STATUS[connectionState] || CONNECTION_STATUS.disconnected;
  }

  const runtimeStatus = String(selectedRuntime?.status || '').toLowerCase();
  if (runtimeStatus === 'queued') {
    return {
      label: runtimeChannelLabel(selectedRuntime, 'queued'),
      className: runtimeClassName(selectedRuntime),
      description: runtimeDescription(selectedRuntime, '当前线程已排队，正在等待开始执行。')
    };
  }

  if (runtimeStatus === 'running') {
    return {
      label: runtimeChannelLabel(selectedRuntime, 'running'),
      className: runtimeClassName(selectedRuntime),
      description: runtimeDescription(selectedRuntime, '当前线程正在运行，正在等待 sync runtime 标明来源。')
    };
  }

  if (runtimeStatus === 'failed') {
    return {
      label: runtimeChannelLabel(selectedRuntime, 'failed'),
      className: runtimeClassName(selectedRuntime, 'is-failed'),
      description: selectedRuntime?.detail || '当前线程任务失败，请查看消息详情。'
    };
  }

  if (desktopBridge?.mode === 'headless-local') {
    return {
      label: '后台可用',
      className: 'is-connected is-headless',
      description: desktopBridge.reason || '桌面端不可用，发送会走后台 Codex。'
    };
  }

  if (desktopBridge?.mode === 'desktop-ipc') {
    return {
      label: selectedSession?.id ? '已同步' : '桌面在线',
      className: 'is-connected is-ipc-ready',
      description: selectedSession?.id
        ? '桌面 IPC 总线在线。普通对话可走后台 Codex；项目会话需要可接管的桌面线程。'
        : '桌面 IPC 总线在线，用于同步桌面会话与刷新桌面线程。'
    };
  }

  return CONNECTION_STATUS.connected;
}
