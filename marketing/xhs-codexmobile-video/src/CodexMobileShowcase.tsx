import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';

const sceneDurations = {
  intro: 120,
  compatibility: 170,
  install: 135,
  work: 155,
  architecture: 135,
  outro: 115,
};

const sceneStarts = {
  intro: 0,
  compatibility: sceneDurations.intro,
  install: sceneDurations.intro + sceneDurations.compatibility,
  work: sceneDurations.intro + sceneDurations.compatibility + sceneDurations.install,
  architecture:
    sceneDurations.intro +
    sceneDurations.compatibility +
    sceneDurations.install +
    sceneDurations.work,
  outro:
    sceneDurations.intro +
    sceneDurations.compatibility +
    sceneDurations.install +
    sceneDurations.work +
    sceneDurations.architecture,
};

export const codexMobileShowcaseDuration = Object.values(sceneDurations).reduce(
  (total, duration) => total + duration,
  0,
);

const colors = {
  ink: '#0b0f14',
  paper: '#fbfaf6',
  text: '#f7f2e8',
  darkText: '#11151b',
  muted: '#c7ccd5',
  darkMuted: '#5f6c7b',
  lineDark: 'rgba(255,255,255,0.14)',
  lineLight: 'rgba(15,20,28,0.12)',
  panelDark: 'rgba(255,255,255,0.08)',
  panelLight: 'rgba(12,16,22,0.06)',
  mint: '#6e7dff',
  cyan: '#5f9bff',
  amber: '#b48bff',
  green: '#38d98d',
  red: '#ff5c62',
};

const brandAssets = {
  icon: 'codex-icon-512.png',
  wordmark: 'pairing-wordmark.png',
  backgroundDark: 'pairing-background.png',
  backgroundLight: 'pairing-background-light.png',
};

const screenshots = {
  chatDark: 'withphone-transparent/chat-dark.png',
  chatLight: 'withphone-transparent/chat-light.png',
  drawerDark: 'withphone-transparent/drawer-dark.png',
  drawerLight: 'withphone-transparent/drawer-light.png',
  longDark: 'withphone-transparent/long-dark.png',
  longLight: 'withphone-transparent/long-light.png',
  gitDark: 'withphone-transparent/git-dark.png',
  gitLight: 'withphone-transparent/git-light.png',
  fileDark: 'withphone-transparent/file-dark.png',
  fileLight: 'withphone-transparent/file-light.png',
  rawChatDark: 'real-ui-01-chat-execution-dark.png',
  rawChatLight: 'real-ui-01-chat-execution-light.png',
  rawDrawerLight: 'real-ui-02-drawer-sessions-light.png',
  rawFileLight: 'real-ui-05-file-preview-light.png',
};

const ease = (frame: number, start: number, duration: number) =>
  interpolate(frame, [start, start + duration], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

const fade = (frame: number, start: number, duration: number) =>
  interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

const yIn = (frame: number, start: number, duration: number, distance = 48) =>
  interpolate(ease(frame, start, duration), [0, 1], [distance, 0]);

const Background = ({light = false, dim = 0.12}: {light?: boolean; dim?: number}) => (
  <AbsoluteFill style={{overflow: 'hidden', background: light ? colors.paper : colors.ink}}>
    <Img
      src={staticFile(light ? brandAssets.backgroundLight : brandAssets.backgroundDark)}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
      }}
    />
    <AbsoluteFill
      style={{
        background: light
          ? `linear-gradient(180deg, rgba(255,255,255,${dim}) 0%, rgba(255,255,255,0.22) 52%, rgba(255,255,255,0.38) 100%)`
          : `linear-gradient(180deg, rgba(0,0,0,${dim}) 0%, rgba(0,0,0,0.22) 52%, rgba(0,0,0,0.4) 100%)`,
      }}
    />
  </AbsoluteFill>
);

const Brand = ({dark = true, compact = false}: {dark?: boolean; compact?: boolean}) => (
  <div style={{display: 'flex', alignItems: 'center', gap: compact ? 15 : 18}}>
    <Img
      src={staticFile(brandAssets.icon)}
      style={{
        width: compact ? 58 : 72,
        height: compact ? 58 : 72,
        display: 'block',
        filter: dark
          ? 'drop-shadow(0 20px 42px rgba(89, 108, 255, 0.42))'
          : 'drop-shadow(0 18px 34px rgba(89, 108, 255, 0.2))',
      }}
    />
    <div>
      <Img
        src={staticFile(brandAssets.wordmark)}
        style={{
          width: compact ? 262 : 330,
          height: 'auto',
          display: 'block',
          filter: dark ? 'invert(1) brightness(1.12)' : 'none',
        }}
      />
      <div
        style={{
          fontSize: compact ? 18 : 21,
          fontWeight: 750,
          color: dark ? colors.muted : colors.darkMuted,
          marginTop: compact ? 5 : 8,
          letterSpacing: 0,
        }}
      >
        浏览器里的本机 Codex 工作台
      </div>
    </div>
  </div>
);

const Pill = ({
  children,
  color = colors.mint,
  light = false,
}: {
  children: React.ReactNode;
  color?: string;
  light?: boolean;
}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '13px 21px',
      borderRadius: 999,
      border: `2px solid ${color}`,
      background: light ? 'rgba(12, 16, 22, 0.055)' : 'rgba(255, 255, 255, 0.075)',
      color,
      fontSize: 24,
      fontWeight: 850,
      letterSpacing: 0,
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </div>
);

const PhoneFrame = ({
  image,
  screenWidth = 420,
  top = 0,
  left = 0,
  rotate = 0,
  scale = 1,
  shadow = true,
}: {
  image: string;
  screenWidth?: number;
  top?: number;
  left?: number;
  rotate?: number;
  scale?: number;
  shadow?: boolean;
}) => {
  const imageHeight = screenWidth * (2520 / 1236);

  return (
    <div
      style={{
        position: 'absolute',
        top,
        left,
        width: screenWidth,
        height: imageHeight,
        filter: shadow ? 'drop-shadow(0 48px 90px rgba(0,0,0,0.46))' : 'none',
        transform: `scale(${scale}) rotate(${rotate}deg)`,
        transformOrigin: 'center',
      }}
    >
      <Img
        src={staticFile(image)}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          objectFit: 'contain',
        }}
      />
    </div>
  );
};

const BrowserCard = ({
  image,
  width,
  height,
  title,
  dark = true,
  top = 0,
  left = 0,
  rotate = 0,
  delay = 0,
}: {
  image: string;
  width: number;
  height: number;
  title: string;
  dark?: boolean;
  top?: number;
  left?: number;
  rotate?: number;
  delay?: number;
}) => {
  const frame = useCurrentFrame();
  const p = ease(frame, delay, 28);
  const isDark = dark;

  return (
    <div
      style={{
        position: 'absolute',
        top,
        left,
        width,
        height,
        borderRadius: 24,
        padding: 12,
        background: isDark ? '#11151b' : '#f8f7f2',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(16,20,28,0.16)'}`,
        boxShadow: isDark ? '0 36px 80px rgba(0,0,0,0.44)' : '0 34px 70px rgba(24,35,48,0.18)',
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [48, 0])}px) rotate(${rotate}deg)`,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          color: isDark ? colors.muted : colors.darkMuted,
          fontSize: 15,
          fontWeight: 800,
        }}
      >
        <div style={{display: 'flex', gap: 6}}>
          {[colors.red, '#f2c94c', colors.green].map((color) => (
            <div key={color} style={{width: 9, height: 9, borderRadius: 999, background: color}} />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            height: 24,
            borderRadius: 999,
            background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(12,16,22,0.08)',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 16,
          }}
        >
          codexmobile.local
        </div>
      </div>
      <div
        style={{
          height: height - 64,
          borderRadius: 18,
          overflow: 'hidden',
          background: isDark ? '#020305' : '#ffffff',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(12,16,22,0.08)'}`,
        }}
      >
        <Img
          src={staticFile(image)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'top center',
            display: 'block',
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 22,
          bottom: 18,
          padding: '9px 13px',
          borderRadius: 999,
          background: isDark ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.82)',
          color: isDark ? colors.text : colors.darkText,
          fontSize: 17,
          fontWeight: 900,
        }}
      >
        {title}
      </div>
    </div>
  );
};

const PlatformCard = ({
  name,
  line,
  color,
  delay,
}: {
  name: string;
  line: string;
  color: string;
  delay: number;
}) => {
  const frame = useCurrentFrame();
  const p = ease(frame, delay, 24);

  return (
    <div
      style={{
        width: 300,
        padding: '24px 24px 22px',
        borderRadius: 28,
        background: 'rgba(255,255,255,0.085)',
        border: '1px solid rgba(255,255,255,0.14)',
        color: colors.text,
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [42, 0])}px)`,
      }}
    >
      <div style={{width: 54, height: 9, borderRadius: 999, background: color, marginBottom: 18}} />
      <div style={{fontSize: 34, fontWeight: 960, lineHeight: 1.1}}>{name}</div>
      <div style={{fontSize: 21, fontWeight: 730, lineHeight: 1.32, color: colors.muted, marginTop: 10}}>
        {line}
      </div>
    </div>
  );
};

const BrowserBar = ({light = false, delay = 0}: {light?: boolean; delay?: number}) => {
  const frame = useCurrentFrame();
  const p = ease(frame, delay, 24);

  return (
    <div
      style={{
        position: 'absolute',
        left: 72,
        right: 72,
        top: 620,
        height: 86,
        borderRadius: 999,
        background: light ? 'rgba(255,255,255,0.86)' : 'rgba(255,255,255,0.09)',
        border: `1px solid ${light ? colors.lineLight : colors.lineDark}`,
        display: 'flex',
        alignItems: 'center',
        padding: '0 28px',
        color: light ? colors.darkText : colors.text,
        boxShadow: light ? '0 22px 60px rgba(30,42,56,0.12)' : '0 28px 68px rgba(0,0,0,0.24)',
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [36, 0])}px)`,
      }}
    >
      <div style={{display: 'flex', gap: 9, marginRight: 20}}>
        {[colors.red, '#f2c94c', colors.green].map((color) => (
          <div key={color} style={{width: 13, height: 13, borderRadius: 999, background: color}} />
        ))}
      </div>
      <div
        style={{
          flex: 1,
          height: 48,
          borderRadius: 999,
          background: light ? 'rgba(12,16,22,0.06)' : 'rgba(0,0,0,0.28)',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 24,
          fontSize: 24,
          fontWeight: 830,
          color: light ? colors.darkMuted : colors.muted,
        }}
      >
        https://codexmobile.local
      </div>
    </div>
  );
};

const TextPanel = ({
  title,
  body,
  color,
  delay,
  light = false,
}: {
  title: string;
  body: string;
  color: string;
  delay: number;
  light?: boolean;
}) => {
  const frame = useCurrentFrame();
  const p = ease(frame, delay, 24);

  return (
    <div
      style={{
        padding: '25px 27px',
        borderRadius: 26,
        background: light ? colors.panelLight : colors.panelDark,
        border: `1px solid ${light ? colors.lineLight : colors.lineDark}`,
        color: light ? colors.darkText : colors.text,
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [36, 0])}px)`,
      }}
    >
      <div style={{display: 'flex', alignItems: 'center', gap: 15}}>
        <div style={{width: 16, height: 48, borderRadius: 999, background: color}} />
        <div style={{fontSize: 31, fontWeight: 950}}>{title}</div>
      </div>
      <div
        style={{
          fontSize: 22,
          lineHeight: 1.36,
          color: light ? colors.darkMuted : colors.muted,
          marginTop: 13,
          fontWeight: 720,
        }}
      >
        {body}
      </div>
    </div>
  );
};

const IntroScene = () => {
  const frame = useCurrentFrame();
  const phone = ease(frame, 18, 40);

  return (
    <AbsoluteFill>
      <Background dim={0.16} />
      <div style={{position: 'absolute', top: 96, left: 72, opacity: fade(frame, 0, 22)}}>
        <Brand />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 260,
          left: 72,
          width: 760,
          color: colors.text,
          opacity: ease(frame, 12, 34),
          transform: `translateY(${yIn(frame, 12, 34)}px)`,
        }}
      >
        <div style={{fontSize: 84, lineHeight: 1.03, fontWeight: 980}}>
          不是手机 App
          <br />
          是 Codex 的 PWA 入口
        </div>
        <div style={{fontSize: 34, lineHeight: 1.34, color: colors.muted, marginTop: 30, fontWeight: 760}}>
          只要设备能打开浏览器，就能接上自己的本机 Codex 工作流。
        </div>
      </div>
      <BrowserBar delay={48} />
      <div
        style={{
          position: 'absolute',
          left: 72,
          bottom: 140,
          display: 'flex',
          gap: 15,
          opacity: ease(frame, 72, 24),
        }}
      >
        <Pill color={colors.mint}>PWA</Pill>
        <Pill color={colors.cyan}>任意浏览器</Pill>
        <Pill color={colors.amber}>本机执行</Pill>
      </div>
      <BrowserCard
        image={screenshots.rawChatDark}
        width={520}
        height={360}
        title="桌面浏览器"
        top={730}
        left={70}
        rotate={-2}
        delay={56}
      />
      <div
        style={{
          opacity: phone,
          transform: `translateX(${interpolate(phone, [0, 1], [170, 0])}px) scale(${interpolate(phone, [0, 1], [0.92, 1])})`,
        }}
      >
        <PhoneFrame image={screenshots.chatDark} screenWidth={360} top={680} left={640} rotate={3} />
      </div>
    </AbsoluteFill>
  );
};

const CompatibilityScene = () => {
  const frame = useCurrentFrame();
  const platforms = [
    {name: 'iPhone', line: 'Safari 添加到主屏幕', color: colors.mint},
    {name: 'Android', line: 'Chrome / Edge 直接安装', color: colors.cyan},
    {name: '平板', line: '大屏浏览器继续使用', color: colors.amber},
    {name: 'Windows', line: '浏览器标签页就是入口', color: colors.green},
  ];

  return (
    <AbsoluteFill>
      <Background dim={0.15} />
      <div style={{position: 'absolute', top: 92, left: 72, opacity: ease(frame, 0, 24)}}>
        <Pill color={colors.cyan}>跨设备兼容</Pill>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 178,
          left: 72,
          width: 850,
          color: colors.text,
          opacity: ease(frame, 6, 30),
          transform: `translateY(${yIn(frame, 6, 30)}px)`,
        }}
      >
        <div style={{fontSize: 78, lineHeight: 1.04, fontWeight: 980}}>
          最大优势：
          <br />
          不挑设备
        </div>
        <div style={{fontSize: 31, lineHeight: 1.36, color: colors.muted, marginTop: 26, fontWeight: 740}}>
          iPhone、Android、平板、Windows、macOS，只要能访问私有地址，就能打开同一个 CodexMobile。
        </div>
      </div>
      <div style={{position: 'absolute', left: 72, top: 548, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18}}>
        {platforms.map((platform, index) => (
          <PlatformCard key={platform.name} {...platform} delay={40 + index * 10} />
        ))}
      </div>
      <BrowserCard
        image={screenshots.rawDrawerLight}
        width={500}
        height={610}
        title="平板 / 桌面浏览器"
        dark={false}
        top={825}
        left={506}
        rotate={2}
        delay={50}
      />
      <PhoneFrame image={screenshots.drawerDark} screenWidth={230} top={1090} left={700} rotate={-4} />
      <div
        style={{
          position: 'absolute',
          left: 72,
          right: 72,
          bottom: 116,
          padding: '29px 34px',
          borderRadius: 30,
          background: 'rgba(255,255,255,0.93)',
          color: colors.darkText,
          fontSize: 33,
          fontWeight: 930,
          lineHeight: 1.25,
          opacity: ease(frame, 112, 24),
        }}
      >
        它不是“又做一个客户端”，而是把 Codex 工作流做成浏览器可访问的控制台。
      </div>
    </AbsoluteFill>
  );
};

const InstallScene = () => {
  const frame = useCurrentFrame();
  const steps = [
    {title: '打开私有地址', body: '局域网、Tailscale 或你的安全入口。', color: colors.mint},
    {title: '保存成 PWA', body: '主屏幕、Dock、任务栏都可以。', color: colors.cyan},
    {title: '像 App 一样用', body: '不依赖应用商店，不绑定单一系统。', color: colors.amber},
  ];

  return (
    <AbsoluteFill>
      <Background light dim={0.24} />
      <div style={{position: 'absolute', top: 94, left: 72, opacity: ease(frame, 0, 24)}}>
        <Brand dark={false} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 72,
          top: 250,
          width: 850,
          color: colors.darkText,
          opacity: ease(frame, 6, 30),
          transform: `translateY(${yIn(frame, 6, 30)}px)`,
        }}
      >
        <div style={{fontSize: 76, lineHeight: 1.05, fontWeight: 980}}>
          一个链接
          <br />
          就是安装入口
        </div>
        <div style={{fontSize: 32, lineHeight: 1.34, color: colors.darkMuted, marginTop: 26, fontWeight: 760}}>
          打开浏览器、保存到桌面，从此像原生 App 一样进入。
        </div>
      </div>
      <BrowserBar light delay={42} />
      <div style={{position: 'absolute', left: 72, top: 730, width: 430, display: 'grid', gap: 20}}>
        {steps.map((step, index) => (
          <TextPanel key={step.title} {...step} delay={56 + index * 12} light />
        ))}
      </div>
      <PhoneFrame image={screenshots.chatLight} screenWidth={365} top={710} left={612} rotate={4} />
      <div
        style={{
          position: 'absolute',
          left: 72,
          right: 72,
          bottom: 126,
          display: 'flex',
          gap: 14,
          opacity: ease(frame, 100, 22),
        }}
      >
        <Pill color={colors.mint} light>
          Add to Home Screen
        </Pill>
        <Pill color={colors.cyan} light>
          Install App
        </Pill>
        <Pill color={colors.amber} light>
          Browser Tab
        </Pill>
      </div>
    </AbsoluteFill>
  );
};

const WorkScene = () => {
  const frame = useCurrentFrame();
  const cards = [
    {title: '长任务展开', body: '工具调用、搜索、Shell 输出都能看见。', color: colors.mint},
    {title: '文件上下文', body: 'README、图片、Markdown 预览继续可用。', color: colors.cyan},
    {title: '轻量 Git 操作', body: '保留移动端高频动作，不做笨重面板。', color: colors.amber},
  ];

  return (
    <AbsoluteFill>
      <Background dim={0.15} />
      <div style={{position: 'absolute', left: 72, top: 92}}>
        <Pill color={colors.mint}>真实工作流</Pill>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 72,
          top: 178,
          width: 820,
          color: colors.text,
          fontSize: 73,
          fontWeight: 980,
          lineHeight: 1.05,
          opacity: ease(frame, 0, 28),
          transform: `translateY(${yIn(frame, 0, 28)}px)`,
        }}
      >
        跨设备不是展示页
        <br />
        是真的能指挥 Codex
      </div>
      <div style={{position: 'absolute', left: 72, top: 420, width: 418, display: 'grid', gap: 20}}>
        {cards.map((card, index) => (
          <TextPanel key={card.title} {...card} delay={30 + index * 14} />
        ))}
      </div>
      <PhoneFrame image={screenshots.longDark} screenWidth={380} top={590} left={602} rotate={2} />
      <PhoneFrame image={screenshots.fileLight} screenWidth={245} top={1070} left={770} rotate={5} />
      <div
        style={{
          position: 'absolute',
          left: 72,
          right: 72,
          bottom: 118,
          color: colors.text,
          fontSize: 32,
          fontWeight: 850,
          lineHeight: 1.34,
          opacity: ease(frame, 104, 24),
        }}
      >
        手机上的每一屏都来自真实项目截图：执行态、会话抽屉、文件预览和 Git 菜单都按当前版本展示。
      </div>
    </AbsoluteFill>
  );
};

const ArchitectureScene = () => {
  const frame = useCurrentFrame();
  const nodes = [
    {title: '浏览器 / PWA', body: 'iPhone、Android、平板、Windows', color: colors.mint},
    {title: '私有网络入口', body: '局域网或 Tailscale 访问', color: colors.cyan},
    {title: '本机桥接服务', body: 'WebSocket 同步运行状态', color: colors.amber},
    {title: 'Codex 执行环境', body: '文件和密钥留在电脑上', color: colors.green},
  ];

  return (
    <AbsoluteFill>
      <Background dim={0.18} />
      <div style={{position: 'absolute', top: 92, left: 72, opacity: ease(frame, 0, 24)}}>
        <Pill color={colors.amber}>为什么适合私有使用</Pill>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 180,
          left: 72,
          width: 850,
          color: colors.text,
          opacity: ease(frame, 8, 30),
          transform: `translateY(${yIn(frame, 8, 30)}px)`,
        }}
      >
        <div style={{fontSize: 75, lineHeight: 1.04, fontWeight: 980}}>
          入口在浏览器
          <br />
          执行仍在本机
        </div>
        <div style={{fontSize: 31, lineHeight: 1.36, color: colors.muted, marginTop: 26, fontWeight: 740}}>
          这就是 PWA 的价值：设备轻，能力不轻。
        </div>
      </div>
      <div style={{position: 'absolute', left: 72, top: 565, right: 72, display: 'grid', gap: 18}}>
        {nodes.map((node, index) => {
          const p = ease(frame, 38 + index * 14, 24);
          return (
            <div
              key={node.title}
              style={{
                height: 126,
                borderRadius: 30,
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(255,255,255,0.085)',
                display: 'flex',
                alignItems: 'center',
                padding: '0 28px',
                color: colors.text,
                opacity: p,
                transform: `translateX(${interpolate(p, [0, 1], [-46, 0])}px)`,
              }}
            >
              <div style={{width: 18, height: 68, borderRadius: 999, background: node.color, marginRight: 24}} />
              <div style={{flex: 1}}>
                <div style={{fontSize: 34, fontWeight: 960}}>{node.title}</div>
                <div style={{fontSize: 23, lineHeight: 1.3, color: colors.muted, marginTop: 8, fontWeight: 720}}>
                  {node.body}
                </div>
              </div>
              <div style={{fontSize: 38, fontWeight: 820, color: node.color}}>
                {index < nodes.length - 1 ? '>' : 'OK'}
              </div>
            </div>
          );
        })}
      </div>
      <BrowserCard
        image={screenshots.rawFileLight}
        width={360}
        height={290}
        title="浏览器页面"
        dark={false}
        top={1290}
        left={74}
        rotate={-2}
        delay={92}
      />
      <PhoneFrame image={screenshots.gitDark} screenWidth={238} top={1198} left={522} rotate={3} />
      <PhoneFrame image={screenshots.longLight} screenWidth={230} top={1265} left={786} rotate={-4} />
    </AbsoluteFill>
  );
};

const OutroScene = () => {
  const frame = useCurrentFrame();
  const p = ease(frame, 0, 34);

  return (
    <AbsoluteFill>
      <Background light dim={0.26} />
      <div style={{position: 'absolute', top: 96, left: 72, opacity: p}}>
        <Brand dark={false} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 72,
          top: 250,
          width: 880,
          color: colors.darkText,
          opacity: p,
          transform: `translateY(${yIn(frame, 0, 34)}px)`,
        }}
      >
        <div style={{fontSize: 80, lineHeight: 1.04, fontWeight: 980}}>
          任何能打开浏览器的设备
          <br />
          都能成为 Codex 控制台
        </div>
        <div style={{fontSize: 34, lineHeight: 1.34, color: colors.darkMuted, marginTop: 30, fontWeight: 770}}>
          手机、平板、电脑都只是入口；真正的项目、文件和执行环境仍然在自己的本机。
        </div>
      </div>
      <BrowserCard
        image={screenshots.rawChatLight}
        width={520}
        height={360}
        title="Windows / macOS 浏览器"
        dark={false}
        top={800}
        left={74}
        rotate={-2}
        delay={34}
      />
      <PhoneFrame image={screenshots.chatDark} screenWidth={320} top={710} left={640} rotate={4} />
      <div
        style={{
          position: 'absolute',
          left: 72,
          right: 72,
          bottom: 120,
          padding: '30px 34px',
          borderRadius: 30,
          background: colors.ink,
          color: colors.text,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          opacity: ease(frame, 70, 26),
        }}
      >
        <div style={{display: 'flex', gap: 14}}>
          <Pill color={colors.mint}>PWA</Pill>
          <Pill color={colors.cyan}>跨平台</Pill>
          <Pill color={colors.amber}>私有本机</Pill>
        </div>
        <div style={{fontSize: 25, fontWeight: 850, color: colors.muted}}>github.com/flyyangX/CodexMobile</div>
      </div>
    </AbsoluteFill>
  );
};

export const CodexMobileShowcase = () => {
  return (
    <AbsoluteFill
      style={{
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
      }}
    >
      <Sequence from={sceneStarts.intro} durationInFrames={sceneDurations.intro} premountFor={30}>
        <IntroScene />
      </Sequence>
      <Sequence from={sceneStarts.compatibility} durationInFrames={sceneDurations.compatibility} premountFor={30}>
        <CompatibilityScene />
      </Sequence>
      <Sequence from={sceneStarts.install} durationInFrames={sceneDurations.install} premountFor={30}>
        <InstallScene />
      </Sequence>
      <Sequence from={sceneStarts.work} durationInFrames={sceneDurations.work} premountFor={30}>
        <WorkScene />
      </Sequence>
      <Sequence from={sceneStarts.architecture} durationInFrames={sceneDurations.architecture} premountFor={30}>
        <ArchitectureScene />
      </Sequence>
      <Sequence from={sceneStarts.outro} durationInFrames={sceneDurations.outro} premountFor={30}>
        <OutroScene />
      </Sequence>
    </AbsoluteFill>
  );
};
