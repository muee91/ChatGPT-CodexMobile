# CodexMobile 小红书展示视频

这个目录是一个独立的 Remotion 竖屏视频工程，用当前 CodexMobile 真实 UI 截图和 README 公开口径生成小红书展示视频。视频主叙事强调 CodexMobile 是跨设备可用的浏览器 PWA：iPhone、Android、平板、Windows / macOS 浏览器都能作为入口，本机仍负责真正执行。

## 输出规格

- 画幅：1080 x 1920
- 帧率：30fps
- 时长：约 27.7 秒
- 成片：`out/codexmobile-xhs-showcase.mp4`
- 手机素材：`public/withphone-transparent/*.png`，来自 `docs/images/codexmobile-real-ui/withphone-transparent/` 的已带手机壳透明截图（1236 x 2520）
- 页面素材：`public/real-ui-*.png`，来自 `docs/images/codexmobile-real-ui/` 的真实 UI 页面截图，用于浏览器 / 平板展示
- 品牌：`codex-icon-512.png`、`pairing-wordmark.png`、`pairing-background*.png`
- 输出保留：`out/codexmobile-xhs-showcase.mp4` 与 `out/codexmobile-xhs-contact-sheet.png`

## 命令

```bash
npm install
npm run still
npm run render
```

也可以打开 Remotion Studio 预览：

```bash
npm run studio
```
