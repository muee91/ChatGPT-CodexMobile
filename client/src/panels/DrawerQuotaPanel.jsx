/**
 * Codex 额度查询面板：渲染账户窗口、刷新状态与失败兜底。
 *
 * Keywords: drawer, quota, codex, usage, account
 *
 * Exports:
 * - DrawerQuotaPanel — 额度查询面板组件。
 *
 * Inward: lucide-react；父级 Drawer 注入额度数据与刷新事件。
 *
 * Outward: Drawer 主视图底部展开时渲染。
 */

import { Loader2 } from 'lucide-react';

function quotaPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) {
    return null;
  }
  return Math.max(0, Math.min(100, percent));
}

function quotaRemainingPercent(quotaWindow) {
  if (!quotaWindow || typeof quotaWindow !== 'object') {
    return null;
  }
  const display = quotaPercent(quotaWindow.displayPercent ?? quotaWindow.display_percent);
  if (display !== null) {
    return display;
  }
  const explicit = quotaPercent(quotaWindow.remainingPercent ?? quotaWindow.remaining_percent);
  if (explicit !== null) {
    return explicit;
  }
  const used = quotaPercent(quotaWindow.usedPercent ?? quotaWindow.used_percent);
  return used === null ? null : Math.max(0, Math.min(100, 100 - used));
}

function formatQuotaPercent(quotaWindow) {
  const percent = quotaRemainingPercent(quotaWindow);
  return percent === null ? '--' : `${Math.round(percent)}%`;
}

function quotaToneClass(percent) {
  if (percent === null) {
    return 'is-low';
  }
  if (percent >= 80) {
    return 'is-healthy';
  }
  if (percent >= 60) {
    return 'is-medium';
  }
  if (percent >= 40) {
    return 'is-warning';
  }
  return 'is-low';
}

export function DrawerQuotaPanel({
  quotaLoading,
  quotaLoaded,
  quotaError,
  quotaNotice,
  quotaAccounts,
  onRefresh
}) {
  return (
    <div className="quota-panel">
      <div className="quota-panel-head">
        <span>额度查询 · Codex</span>
        <button
          type="button"
          className="quota-refresh"
          onClick={onRefresh}
          disabled={quotaLoading}
        >
          {quotaLoading ? <Loader2 className="spin" size={12} /> : null}
          {quotaLoading ? '刷新中' : '刷新'}
        </button>
      </div>
      {quotaError ? (
        <button type="button" className="quota-error" onClick={onRefresh}>
          {quotaError}
        </button>
      ) : null}
      {!quotaError && quotaNotice ? (
        <button type="button" className="quota-error" onClick={onRefresh}>
          {quotaNotice}，点击刷新
        </button>
      ) : null}
      {!quotaError && quotaAccounts.length ? (
        quotaAccounts.map((account) => {
          const windows = Array.isArray(account.windows) ? account.windows : [];
          const accountStatus = account.status || 'ok';
          const plan = account.plan || 'Codex';
          return (
            <div key={account.id} className={`quota-account is-${accountStatus}`}>
              <div className="quota-account-head">
                <span>{account.label || 'Codex'}</span>
                <small>{plan}</small>
              </div>
              {accountStatus === 'ok' && windows.length ? (
                <div className="quota-window-list">
                  {windows.map((quotaWindow) => {
                    const percent = quotaRemainingPercent(quotaWindow);
                    return (
                      <div
                        key={quotaWindow.id}
                        className={`quota-window ${quotaToneClass(percent)}`}
                        style={{ '--quota-percent': `${percent ?? 0}%` }}
                      >
                        <div className="quota-window-meta">
                          <span>{quotaWindow.label}</span>
                          <strong>{formatQuotaPercent(quotaWindow)}</strong>
                        </div>
                        <div className="quota-bar">
                          <span />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <button
                  type="button"
                  className="quota-account-message"
                  onClick={accountStatus === 'failed' ? onRefresh : undefined}
                >
                  {accountStatus === 'disabled' ? '已停用' : `${account.error || '查询失败'}，点击刷新重试`}
                </button>
              )}
            </div>
          );
        })
      ) : null}
      {!quotaLoading && !quotaError && quotaLoaded && !quotaAccounts.length ? (
        <div className="quota-empty">暂无 Codex 凭证</div>
      ) : null}
      {!quotaLoading && !quotaError && !quotaLoaded ? (
        <div className="quota-empty">点击右上角刷新查询额度</div>
      ) : null}
    </div>
  );
}
