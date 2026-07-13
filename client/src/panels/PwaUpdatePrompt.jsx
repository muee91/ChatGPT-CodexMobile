/**
 * PWA 新版本提示条：检测到前端包更新后，引导用户点一次刷新。
 *
 * Keywords: pwa, update, refresh, prompt
 *
 * Exports:
 * - PwaUpdatePrompt — 底部固定的新版本刷新提示。
 *
 * Inward: lucide-react 图标、usePwaUpdate 传入的状态与动作。
 *
 * Outward: AppShell.jsx。
 */

import { RefreshCw, X } from 'lucide-react';

export function PwaUpdatePrompt({ available, onRefresh, onDismiss }) {
  if (!available) {
    return null;
  }

  return (
    <div className="pwa-update-prompt" role="status" aria-live="polite">
      <span className="pwa-update-dot" aria-hidden="true" />
      <span className="pwa-update-copy">
        <strong>有新版本</strong>
        <small>前端资源已更新，点一下刷新到最新包。</small>
      </span>
      <button type="button" className="pwa-update-refresh" onClick={onRefresh}>
        <RefreshCw size={14} />
        <span>刷新</span>
      </button>
      <button type="button" className="pwa-update-dismiss" onClick={onDismiss} aria-label="暂不刷新">
        <X size={14} />
      </button>
    </div>
  );
}
