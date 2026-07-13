/**
 * 截图演示入口：用真实 AppShell/FilePreviewApp 组件加载脱敏 mock 数据生成官网截图。
 *
 * Keywords: demo, screenshots, AppShell, mock-data, real-ui
 *
 * Exports:
 * - default — `DemoScreenshotApp`，供 `/demo/screenshots` 路由渲染真实组件截图。
 *
 * Inward: AppShell、FilePreviewApp、pwa-theme；本文件内 mock fetch 与 props 工厂。
 *
 * Outward: main.jsx 在截图路由挂载；Chrome headless 生成 docs/images 下的演示图。
 *
 * 不负责: 生产数据读取、认证配对、真实 Git/文件写入。
 */

import { useMemo } from 'react';
import FilePreviewApp from '../app/FilePreviewApp.jsx';
import { AppShell } from '../app/AppShell.jsx';
import { applyPwaTheme } from '../app/pwa-theme.js';
import { DEFAULT_PERMISSION_MODE } from '../composer/Composer.jsx';

const NOW = new Date('2026-05-15T02:10:00+08:00').getTime();
const SESSION_ID = 'demo-codexmobile-thread';
const PROJECT_ID = 'codexmobile';
const DEMO_PATH = '/Users/demo/Projects/CodexMobile';

const project = {
  id: PROJECT_ID,
  name: 'CodexMobile',
  path: DEMO_PATH,
  pathLabel: '~/Projects/CodexMobile'
};

const projectless = {
  id: 'projectless',
  name: '无项目',
  path: '',
  pathLabel: '',
  projectless: true
};

const selectedSession = {
  id: SESSION_ID,
  projectId: PROJECT_ID,
  title: '移动端截图演示',
  summary: '真实组件 + 脱敏 mock 数据',
  updatedAt: '2026-05-15T01:58:00+08:00',
  startedAt: '2026-05-15T01:52:00+08:00'
};

const runningSession = {
  ...selectedSession,
  title: '移动端执行过程展示',
  running: true,
  runStatus: 'running',
  updatedAt: '2026-05-15T02:08:00+08:00'
};

const sessionsByProject = {
  projectless: [
    { id: 'quick-note', projectId: 'projectless', title: '快速记录一个想法', summary: '普通对话 · 12 分钟', updatedAt: '2026-05-15T01:45:00+08:00' }
  ],
  [PROJECT_ID]: [
    runningSession,
    { id: 'pwa-update', projectId: PROJECT_ID, title: 'PWA 更新提示与刷新策略', summary: '完成 · 18 分钟', updatedAt: '2026-05-15T01:38:00+08:00', hasCompleteNotice: true },
    { id: 'git-menu', projectId: PROJECT_ID, title: 'Git 小菜单操作确认', summary: 'codex/git-menu · 2 小时', updatedAt: '2026-05-14T23:42:00+08:00' },
    { id: 'subagent-review', projectId: PROJECT_ID, title: '子代理：截图回归检查', summary: '并行任务 · 3 小时', updatedAt: '2026-05-14T22:58:00+08:00', subagent: true },
    { id: 'file-preview', projectId: PROJECT_ID, title: '本地文件预览链路', summary: 'Markdown / PDF / 图片', updatedAt: '2026-05-14T20:12:00+08:00' }
  ]
};

const activityMessage = {
  id: 'activity-demo',
  role: 'activity',
  status: 'running',
  clientTurnId: 'turn-demo',
  sessionId: SESSION_ID,
  timestamp: '2026-05-15T02:07:00+08:00',
  startedAt: '2026-05-15T02:07:00+08:00',
  label: '正在处理',
  content: '正在处理',
  activities: [
    {
      id: 'reasoning-1',
      kind: 'reasoning',
      label: '正在思考',
      status: 'completed',
      startedAt: '2026-05-15T02:07:00+08:00',
      completedAt: '2026-05-15T02:07:10+08:00'
    },
    {
      id: 'search-1',
      kind: 'command_execution',
      label: '搜索项目入口',
      detail: 'rg -n "AppShell|Composer|TopBar|GitQuickDialog" client/src',
      command: 'rg -n "AppShell|Composer|TopBar|GitQuickDialog" client/src',
      status: 'completed',
      startedAt: '2026-05-15T02:07:12+08:00',
      completedAt: '2026-05-15T02:07:22+08:00',
      output: 'client/src/app/AppShell.jsx\nclient/src/composer/Composer.jsx\nclient/src/panels/TopBar.jsx\nclient/src/panels/GitQuickDialog.jsx'
    },
    {
      id: 'test-1',
      kind: 'command_execution',
      label: '运行前端测试',
      detail: 'node --test client/src/*.test.mjs',
      command: 'node --test client/src/*.test.mjs',
      status: 'running',
      startedAt: '2026-05-15T02:07:28+08:00'
    }
  ]
};

const completedActivityMessage = {
  ...activityMessage,
  id: 'activity-completed-demo',
  status: 'completed',
  label: '过程已同步',
  content: '过程已同步',
  completedAt: '2026-05-15T02:08:30+08:00',
  durationMs: 90_000,
  activities: activityMessage.activities.map((step) => ({
    ...step,
    status: 'completed',
    completedAt: step.completedAt || '2026-05-15T02:08:30+08:00',
    fileChanges: step.id === 'test-1'
      ? [
        {
          path: 'client/src/demo/DemoScreenshotApp.jsx',
          status: 'modified',
          diff: '@@ -0,0 +1,3 @@\n+export default function DemoScreenshotApp() {\n+  return <AppShell {...props} />;\n+}'
        },
        {
          path: 'docs/images/codexmobile-real-ui/real-ui-01-chat-execution-dark.png',
          status: 'updated',
          diff: '@@ -1 +1 @@\n-旧截图\n+真实组件截图'
        }
      ]
      : []
  }))
};

const baseMessages = [
  {
    id: 'user-1',
    role: 'user',
    content: '请用当前项目真实 UI 生成一组公开展示截图，数据必须脱敏。',
    timestamp: '2026-05-15T02:06:45+08:00'
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    content: '我会直接挂载真实前端组件，注入 mock 项目、线程、Git 和文件数据，再用浏览器截图。',
    timestamp: '2026-05-15T02:06:58+08:00'
  }
];

const finalMessages = [
  ...baseMessages,
  completedActivityMessage,
  {
    id: 'assistant-2',
    role: 'assistant',
    content: '已生成真实组件截图：聊天执行流、项目会话、Composer、Git 小菜单和本地文件预览都来自当前 React 组件。',
    timestamp: '2026-05-15T02:08:35+08:00'
  }
];

const longTaskActivityMessage = {
  id: 'activity-long-task-demo',
  role: 'activity',
  status: 'running',
  forceOpen: true,
  forceTimeline: true,
  clientTurnId: 'turn-long-task-demo',
  sessionId: SESSION_ID,
  timestamp: '2026-05-15T02:14:00+08:00',
  startedAt: '2026-05-15T02:11:00+08:00',
  label: '正在运行长任务',
  content: '正在运行长任务',
  activities: [
    {
      id: 'long-note-1',
      kind: 'agent_message',
      label: '先确认当前 UI 入口，再用真实组件跑截图；所有项目名、路径和输出都使用脱敏 mock 数据。',
      status: 'completed',
      timestamp: '2026-05-15T02:11:13+08:00'
    },
    {
      id: 'long-rg-1',
      kind: 'command_execution',
      label: '搜索运行态组件',
      command: 'rg -n "ActivityMessage|ActivityTimeline|Composer|TopBar" client/src',
      detail: 'rg -n "ActivityMessage|ActivityTimeline|Composer|TopBar" client/src',
      output: [
        'client/src/chat/ActivityMessage.jsx',
        'client/src/chat/ActivityTimeline.jsx',
        'client/src/composer/Composer.jsx',
        'client/src/panels/TopBar.jsx'
      ].join('\n'),
      status: 'completed',
      startedAt: '2026-05-15T02:11:15+08:00',
      completedAt: '2026-05-15T02:11:24+08:00'
    },
    {
      id: 'long-read-1',
      kind: 'command_execution',
      label: '读取截图路由',
      command: 'sed -n "1,220p" client/src/demo/DemoScreenshotApp.jsx',
      detail: '检查 demo scene 与 mock props',
      output: '找到 /demo/screenshots 路由、真实 AppShell 挂载点、mock fetch 和场景切换逻辑。',
      status: 'completed',
      startedAt: '2026-05-15T02:11:28+08:00',
      completedAt: '2026-05-15T02:11:36+08:00'
    },
    {
      id: 'long-agent-1',
      kind: 'subagent_activity',
      label: '2 个后台智能体正在并行检查',
      detail: '分别检查移动端视觉层级和截图数据完整性。',
      status: 'completed',
      startedAt: '2026-05-15T02:11:40+08:00',
      completedAt: '2026-05-15T02:12:08+08:00',
      subAgents: [
        { nickname: 'UI 巡检', role: 'explorer', statusText: '已确认抽屉层级' },
        { nickname: '截图校验', role: 'worker', statusText: '已确认 iPhone 17 Pro Max viewport' }
      ]
    },
    {
      id: 'long-edit-1',
      kind: 'file_change',
      label: '更新演示数据',
      detail: '把空白 Composer 首页替换为长任务执行时间线。',
      status: 'completed',
      startedAt: '2026-05-15T02:12:12+08:00',
      completedAt: '2026-05-15T02:12:28+08:00',
      fileChanges: [
        {
          path: 'client/src/demo/DemoScreenshotApp.jsx',
          status: 'modified',
          diff: '@@\n+const longTaskActivityMessage = { ... };\n+messages: longTaskMessages'
        },
        {
          path: 'client/src/chat/chat-render-items.js',
          status: 'modified',
          diff: '@@\n-const currentRuntimeActivity = ...\n+const currentRuntimeActivity = !message.forceTimeline && ...'
        }
      ]
    },
    {
      id: 'long-build-1',
      kind: 'command_execution',
      label: '构建前端',
      command: 'npm run build',
      detail: 'vite build --config client/vite.config.js',
      output: '✓ 4017 modules transformed\n✓ built in 8.7s',
      status: 'completed',
      startedAt: '2026-05-15T02:12:31+08:00',
      completedAt: '2026-05-15T02:12:45+08:00'
    },
    {
      id: 'long-shot-1',
      kind: 'command_execution',
      label: '重新生成 iPhone 17 Pro Max 截图',
      command: 'node marketing/real-ui-screenshots/generate.mjs',
      detail: '以 440x956 viewport 输出 1320x2868 的深色 / 浅色 UI 演示图',
      output: 'real-ui-03-composer-workflow-dark.png 1320x2868\nreal-ui-03-composer-workflow-light.png 1320x2868',
      status: 'running',
      startedAt: '2026-05-15T02:12:50+08:00'
    }
  ]
};

const longTaskMessages = [longTaskActivityMessage];

const skills = [
  { name: 'qingtian-sales-analysis', label: 'qingtian-sales-analysis', path: '/skills/qingtian-sales-analysis/SKILL.md', description: '青甜销售分析与复盘' },
  { name: 'frontend-design', label: 'frontend-design', path: '/skills/frontend-design/SKILL.md', description: '前端设计与视觉检查' },
  { name: 'pandoc-pdf-pro', label: 'pandoc-pdf-pro', path: '/skills/pandoc-pdf-pro/SKILL.md', description: '高质量 PDF 导出' }
];

const models = [
  { value: 'gpt-5.5', label: 'GPT-5.5' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' }
];

const noop = () => undefined;
const noopAsync = async () => undefined;

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function installDemoFetch() {
  if (window.__codexmobileDemoFetchInstalled) {
    return;
  }
  window.__codexmobileDemoFetchInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.includes('/api/git/status')) {
      return jsonResponse({ status: demoGitStatus() });
    }
    if (url.includes('/api/git/branches')) {
      return jsonResponse({ branches: demoBranches() });
    }
    if (url.includes('/api/git/diff')) {
      return jsonResponse({ diff: demoDiff() });
    }
    if (url.includes('/api/local-file')) {
      return new Response(demoMarkdown(), {
        status: 200,
        headers: {
          'content-type': 'text/markdown; charset=utf-8',
          'x-local-file-editable': '1',
          'x-local-file-mtime-ms': String(NOW)
        }
      });
    }
    return originalFetch(input, init);
  };
}

function demoGitStatus() {
  return {
    branch: 'codex/real-ui-screenshots',
    upstream: 'origin/codex/real-ui-screenshots',
    clean: false,
    ahead: 1,
    behind: 0,
    canCommit: true,
    defaultCommitMessage: 'Update CodexMobile demo screenshots',
    fileCount: 6,
    files: [
      { status: 'M', path: 'client/src/demo/DemoScreenshotApp.jsx' },
      { status: 'M', path: 'client/src/main.jsx' },
      { status: 'A', path: 'docs/images/codexmobile-real-ui/real-ui-01-chat-execution-dark.png' },
      { status: 'A', path: 'docs/images/codexmobile-real-ui/real-ui-04-git-menu-light.png' }
    ]
  };
}

function demoBranches() {
  return {
    current: 'codex/real-ui-screenshots',
    defaultBranch: 'main',
    branches: [
      { name: 'codex/real-ui-screenshots', current: true, upstream: 'origin/codex/real-ui-screenshots' },
      { name: 'main', default: true, upstream: 'origin/main' },
      { name: 'codex/pwa-update', upstream: 'origin/codex/pwa-update' }
    ]
  };
}

function demoDiff() {
  return {
    status: demoGitStatus(),
    summary: '6 files changed, 184 insertions(+), 18 deletions(-)',
    patch: [
      'diff --git a/client/src/demo/DemoScreenshotApp.jsx b/client/src/demo/DemoScreenshotApp.jsx',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/client/src/demo/DemoScreenshotApp.jsx',
      '@@ -0,0 +1,7 @@',
      '+export default function DemoScreenshotApp() {',
      '+  return <AppShell {...demoProps} />;',
      '+}',
      '',
      'diff --git a/client/src/main.jsx b/client/src/main.jsx',
      '@@ -17,4 +18,5 @@',
      '-const RootApp = window.location.pathname === \'/preview/file\' ? FilePreviewApp : App;',
      '+const RootApp = window.location.pathname === \'/demo/screenshots\' ? DemoScreenshotApp : App;'
    ].join('\n')
  };
}

function demoMarkdown() {
  return [
    '# CodexMobile',
    '',
    'CodexMobile 是一个面向个人私有化部署的移动端 Codex 工作台。电脑继续作为真正的执行环境，移动设备负责随时接管、追问、查看过程和处理确认。',
    '',
    '> 本截图来自真实 FilePreviewApp 组件，内容为脱敏演示文本。',
    '',
    '## 当前能力',
    '',
    '- 读取本机 `~/.codex` 会话和项目状态',
    '- 通过 Desktop IPC 接管已有线程',
    '- 后台 fallback 保持移动端新任务可执行',
    '- 在手机上处理 Git、文件、skill 和完成通知',
    '',
    '## 安全边界',
    '',
    '真实文件、密钥和执行能力仍留在自己的电脑上，移动端通过配对码和可信私有网络访问。'
  ].join('\n');
}

function basePanelProps({ scene, theme }) {
  return {
    topBarProps: {
      selectedProject: project,
      selectedSession: selectedSessionForScene(scene),
      connectionState: 'connected',
      desktopBridge: { available: true, connected: true, mode: 'ipc' },
      selectedRuntime: scene === 'chat' || scene === 'composer' ? { status: 'running', startedAt: '2026-05-15T02:07:00+08:00', steerable: true } : null,
      onMenu: noop,
      onOpenDocs: noop,
      onGitAction: noop,
      onDesktopHandoff: noopAsync,
      desktopHandoffSupported: true,
      desktopHandoffPending: false,
      notificationSupported: true,
      notificationEnabled: true,
      onEnableNotifications: noop,
      gitDisabled: false,
      homeMode: false,
      initialGitMenuOpen: scene === 'git-menu'
    },
    docsPanelProps: {
      open: false,
      docs: { connected: false },
      busy: false,
      error: '',
      onClose: noop,
      onConnect: noopAsync,
      onDisconnect: noopAsync,
      onOpenHome: noop,
      onOpenAuth: noop,
      onRefresh: noopAsync
    },
    gitPanelProps: {
      open: false,
      action: 'diff',
      project,
      onToast: noop,
      onClose: noop
    },
    gitQuickDialogProps: {
      dialog: null,
      onCancel: noop,
      onSubmit: noop
    },
    recoveryCardProps: {
      state: null,
      onRetry: noop,
      onSync: noop,
      onPair: noop,
      onStatus: noop
    },
    toastStackProps: {
      toasts: scene === 'chat' ? [{ id: 'toast-1', level: 'success', title: '任务完成通知已开启', body: '移动端会收到完成提醒。' }] : [],
      onDismiss: noop
    },
    pwaUpdateProps: {
      available: scene === 'drawer',
      onRefresh: noop,
      onDismiss: noop
    },
    imagePreviewProps: {
      image: null,
      onClose: noop
    }
  };
}

function selectedSessionForScene(scene) {
  return scene === 'chat' || scene === 'composer' ? runningSession : selectedSession;
}

function drawerProps({ scene, theme }) {
  const session = selectedSessionForScene(scene);
  return {
    open: scene === 'drawer',
    onClose: noop,
    projects: [projectless, project],
    selectedProject: project,
    selectedSession: session,
    expandedProjectIds: { [PROJECT_ID]: true, projectless: true },
    sessionsByProject,
    loadingProjectId: null,
    runningById: { [SESSION_ID]: scene === 'chat' || scene === 'drawer' || scene === 'composer' },
    threadRuntimeById: {
      [SESSION_ID]: { status: 'running', startedAt: '2026-05-15T02:07:00+08:00', updatedAt: '2026-05-15T02:08:00+08:00' }
    },
    completedSessionIds: { 'pwa-update': true },
    onToggleProject: noop,
    onSelectSession: noop,
    onRenameSession: noopAsync,
    onDeleteSession: noopAsync,
    onNewConversation: noop,
    onSync: noopAsync,
    syncing: false,
    theme,
    setTheme: noop,
    runtimeDebug: { enabled: false },
    desktopRefresh: { supported: true, enabled: true },
    security: {
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      trustedDevices: 2,
      currentDeviceName: 'iPhone'
    },
    onLoggedOut: noop,
    refreshStatus: noopAsync
  };
}

function chatProps({ scene }) {
  const isLongTask = scene === 'composer';
  return {
    messages: isLongTask ? longTaskMessages : scene === 'chat' ? [...baseMessages, activityMessage] : finalMessages,
    selectedSession: selectedSessionForScene(scene) || selectedSession,
    loading: false,
    loadError: '',
    running: scene === 'chat' || isLongTask,
    activeRuntimeStartedAt: '2026-05-15T02:07:00+08:00',
    now: NOW,
    hasMoreBefore: scene === 'chat',
    loadingOlder: false,
    onLoadOlderMessages: noop,
    onPreviewImage: noop,
    onDeleteMessage: noop,
    onImplementPlan: noop,
    onAdjustPlan: noop
  };
}

function composerProps({ scene }) {
  const isLongTask = scene === 'composer';
  return {
    composerRef: null,
    input: '',
    setInput: noop,
    selectedProject: project,
    gitProject: project,
    selectedSession: selectedSessionForScene(scene),
    onSubmit: noopAsync,
    running: scene === 'chat' || isLongTask,
    onAbort: noop,
    models,
    selectedModel: 'gpt-5.5',
    onSelectModel: noop,
    selectedModelSpeed: 'balanced',
    onSelectModelSpeed: noop,
    selectedReasoningEffort: 'medium',
    onSelectReasoningEffort: noop,
    selectedCollaborationMode: isLongTask ? 'plan' : null,
    onSelectCollaborationMode: noop,
    skills,
    selectedSkillPaths: isLongTask ? ['/skills/frontend-design/SKILL.md'] : [],
    onToggleSkill: noop,
    onSelectSkill: noop,
    onClearSkills: noop,
    permissionMode: DEFAULT_PERMISSION_MODE,
    onSelectPermission: noop,
    security: { approvalPolicy: 'on-request', sandboxMode: 'workspace-write' },
    attachments: [],
    onUploadFiles: noop,
    onRemoveAttachment: noop,
    fileMentions: [],
    onAddFileMention: noop,
    onRemoveFileMention: noop,
    uploading: false,
    contextStatus: {
      available: true,
      usedTokens: 128_000,
      maxTokens: 400_000,
      percent: 32,
      label: '上下文 32%'
    },
    runSteerable: true,
    desktopBridge: { available: true, connected: true, mode: 'ipc' },
    queueDrafts: scene === 'chat' || isLongTask
      ? [{ id: 'queue-1', text: '顺便把 README 截图引用也更新掉', mode: 'queue', createdAt: '2026-05-15T02:08:00+08:00' }]
      : [],
    onRestoreQueueDraft: noop,
    onRemoveQueueDraft: noop,
    onSteerQueueDraft: noop,
    onCreateGitBranch: noopAsync,
    onCompactContext: noop,
    readOnly: false,
    readOnlyReason: '',
    homeMode: false,
    projects: [projectless, project],
    onSelectHomeProject: noop
  };
}

function shellClass(scene) {
  const classes = ['app-shell', 'is-screenshot-demo'];
  if (scene === 'drawer') {
    classes.push('drawer-active');
  }
  if (scene === 'composer') {
    classes.push('is-long-task-demo');
  }
  return classes.join(' ');
}

function ScreenshotViewportGuard() {
  return (
    <style>
      {`
        .app-shell.is-screenshot-demo {
          width: 100vw;
          max-width: 100vw;
          overflow: hidden;
        }

        .app-shell.is-screenshot-demo .chat-pane {
          width: 100vw;
          max-width: 100vw;
          padding-left: 14px;
          padding-right: 18px;
          overflow-x: hidden;
        }

        .app-shell.is-screenshot-demo .chat-content,
        .app-shell.is-screenshot-demo .message-row,
        .app-shell.is-screenshot-demo .message-stack,
        .app-shell.is-screenshot-demo .message-bubble,
        .app-shell.is-screenshot-demo .activity-bubble,
        .app-shell.is-screenshot-demo .activity-timeline,
        .app-shell.is-screenshot-demo .activity-segment,
        .app-shell.is-screenshot-demo .activity-segment-text,
        .app-shell.is-screenshot-demo .activity-segment-tools,
        .app-shell.is-screenshot-demo .activity-meta,
        .app-shell.is-screenshot-demo .activity-meta-body,
        .app-shell.is-screenshot-demo .activity-command-detail,
        .app-shell.is-screenshot-demo .activity-shell,
        .app-shell.is-screenshot-demo .activity-file-summary,
        .app-shell.is-screenshot-demo .activity-file-item,
        .app-shell.is-screenshot-demo .activity-file-item summary,
        .app-shell.is-screenshot-demo .activity-diff-shell,
        .app-shell.is-screenshot-demo .activity-diff-view,
        .app-shell.is-screenshot-demo .activity-diff-row,
        .app-shell.is-screenshot-demo .composer-wrap,
        .app-shell.is-screenshot-demo .composer {
          max-width: 100%;
          min-width: 0;
          overflow-x: hidden;
        }

        .app-shell.is-screenshot-demo .activity-timeline {
          display: block;
          width: calc(100% - 9px);
          max-width: calc(100% - 9px);
        }

        .app-shell.is-screenshot-demo .activity-segment,
        .app-shell.is-screenshot-demo .activity-segment-text,
        .app-shell.is-screenshot-demo .activity-segment-tools,
        .app-shell.is-screenshot-demo .activity-meta-body,
        .app-shell.is-screenshot-demo .activity-command-detail,
        .app-shell.is-screenshot-demo .activity-shell,
        .app-shell.is-screenshot-demo .activity-file-summary,
        .app-shell.is-screenshot-demo .activity-file-item,
        .app-shell.is-screenshot-demo .activity-diff-shell,
        .app-shell.is-screenshot-demo .activity-diff-view,
        .app-shell.is-screenshot-demo .activity-diff-row {
          width: 100%;
        }

        .app-shell.is-screenshot-demo .activity-file-item summary {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto auto auto;
          gap: 5px;
        }

        .app-shell.is-screenshot-demo .activity-file-item summary span,
        .app-shell.is-screenshot-demo .activity-diff-row code {
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .app-shell.is-screenshot-demo .activity-diff-row {
          grid-template-columns: 22px 22px 12px minmax(0, 1fr);
        }

        .app-shell.is-screenshot-demo .activity-command-detail summary {
          max-width: 100%;
          min-width: 0;
        }

        .app-shell.is-screenshot-demo .activity-command-detail summary span,
        .app-shell.is-screenshot-demo .activity-meta-summary span,
        .app-shell.is-screenshot-demo .activity-live span,
        .app-shell.is-screenshot-demo .activity-markdown,
        .app-shell.is-screenshot-demo .activity-meta-detail,
        .app-shell.is-screenshot-demo .message-content,
        .app-shell.is-screenshot-demo .message-content * {
          display: block;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          overflow-wrap: anywhere;
          word-break: break-all;
        }

        .app-shell.is-screenshot-demo .activity-command-detail summary span,
        .app-shell.is-screenshot-demo .activity-meta-summary span,
        .app-shell.is-screenshot-demo .activity-summary-title,
        .app-shell.is-screenshot-demo .activity-text,
        .app-shell.is-screenshot-demo .activity-text p,
        .app-shell.is-screenshot-demo .activity-markdown p {
          white-space: normal !important;
        }

        .app-shell.is-screenshot-demo .activity-shell pre,
        .app-shell.is-screenshot-demo .activity-shell code,
        .app-shell.is-screenshot-demo .message-content pre,
        .app-shell.is-screenshot-demo .message-content code {
          max-width: 100%;
          overflow-x: hidden;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .app-shell.is-screenshot-demo .activity-live {
          display: flex;
          width: 100%;
          max-width: 100%;
        }

        .app-shell.is-screenshot-demo .activity-live span {
          display: block;
          width: 100%;
          min-width: 0;
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-all;
        }

        .app-shell.is-screenshot-demo .composer-wrap {
          padding-left: 14px;
          padding-right: 18px;
        }

        .app-shell.is-screenshot-demo .composer-controls {
          gap: 4px;
          padding-right: 6px;
        }

        .app-shell.is-screenshot-demo .composer-tool-strip {
          gap: 1px;
          overflow: visible;
          transform: scale(0.84);
          transform-origin: right center;
        }

        .app-shell.is-screenshot-demo .composer-tool-icon,
        .app-shell.is-screenshot-demo .composer-attach {
          width: 31px;
          height: 31px;
        }

        .app-shell.is-screenshot-demo .context-status-compact,
        .app-shell.is-screenshot-demo .context-status-button {
          width: 27px;
          min-width: 27px;
          padding: 0;
        }

        .app-shell.is-screenshot-demo .model-chip {
          max-width: 64px;
          padding-left: 3px;
          padding-right: 1px;
        }

        .app-shell.is-screenshot-demo .send-button {
          width: 36px;
          height: 36px;
          min-width: 36px;
        }

        .app-shell.is-screenshot-demo .top-bar {
          max-width: 100vw;
          overflow: hidden;
        }
      `}
    </style>
  );
}

export default function DemoScreenshotApp() {
  installDemoFetch();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  const scene = params.get('scene') || 'chat';
  localStorage.setItem('codexmobile.theme', theme);
  applyPwaTheme(theme);

  if (scene === 'file-preview') {
    return <FilePreviewApp />;
  }

  const context = { scene, theme };
  return (
    <>
      <ScreenshotViewportGuard />
      <AppShell
        shellClass={shellClass(scene)}
        panelProps={basePanelProps(context)}
        drawerProps={drawerProps(context)}
        chatProps={chatProps(context)}
        composerProps={composerProps(context)}
        homeVisible={false}
      />
    </>
  );
}
