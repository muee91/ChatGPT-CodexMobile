/**
 * 应用内多条 Toast 的堆叠展示与单条关闭。
 *
 * Keywords: toast, notification, UI, dismiss
 *
 * Exports:
 * - ToastStack — Toast 列表组件。
 *
 * Inward: lucide-react。
 *
 * Outward: 与 useNotifications 或全局提醒逻辑配合挂载。
 */

import { X } from 'lucide-react';

export function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) {
    return null;
  }
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-item is-${toast.level || 'info'}`}>
          <span className="toast-dot" />
          <span>
            <strong>{toast.title}</strong>
            {toast.body ? <small>{toast.body}</small> : null}
          </span>
          <button type="button" onClick={() => onDismiss(toast.id)} aria-label="关闭提醒">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
