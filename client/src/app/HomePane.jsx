/**
 * CodexMobile 首页空态：在新对话草稿前显示桌面端同款主问题。
 *
 * Keywords: home, empty-state, new-chat
 *
 * Exports:
 * - HomePane — 渲染首页标题区域，Composer 仍由外层 Shell 复用。
 *
 * Inward: 无。
 *
 * Outward: AppShell 在首页态替代 ChatPane 挂载。
 */

export function HomePane() {
  return (
    <section className="chat-pane home-pane" aria-label="首页">
      <div className="home-content">
        <h1>要在 CodexMobile 中构建什么？</h1>
      </div>
    </section>
  );
}
