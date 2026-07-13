import {execFileSync, spawn} from 'node:child_process';
import {existsSync, mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outputDir = path.join(repoRoot, 'docs/images/codexmobile-real-ui');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 4177;
const baseUrl = `http://127.0.0.1:${port}`;
const viewportSize = {width: 440, height: 956};
const deviceScaleFactor = 3;

const scenes = [
  ['01-chat-execution', 'chat'],
  ['02-drawer-sessions', 'drawer'],
  ['03-composer-workflow', 'composer'],
  ['04-git-menu', 'git-menu'],
  ['05-file-preview', 'file-preview']
];

function waitForServer(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      execFileSync('curl', ['-fsS', url], {stdio: 'ignore'});
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function assertViewport(page) {
  const metrics = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const out = [];
    for (const element of document.querySelectorAll('body *')) {
      const rect = element.getBoundingClientRect();
      const visibleLeftCrop = rect.left < -1 && rect.right > 1;
      if (rect.width > 0 && (rect.right > viewportWidth + 1 || visibleLeftCrop)) {
        out.push({
          tag: element.tagName,
          className: String(element.className || '').slice(0, 120),
          text: (element.innerText || element.textContent || '').replace(/\s+/g, ' ').slice(0, 120),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width)
        });
      }
    }
    return {
      innerWidth,
      innerHeight,
      devicePixelRatio,
      viewportWidth,
      viewportHeight: document.documentElement.clientHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      overflowing: out.slice(0, 20)
    };
  });

  if (
    metrics.innerWidth !== viewportSize.width ||
    metrics.viewportWidth !== viewportSize.width ||
    metrics.documentScrollWidth > viewportSize.width ||
    metrics.overflowing.length
  ) {
    throw new Error(`Invalid screenshot viewport: ${JSON.stringify(metrics, null, 2)}`);
  }
  return metrics;
}

async function captureScreenshot(page, url, output, {scene}) {
  await page.goto(url, {waitUntil: 'networkidle'});
  await page.waitForTimeout(350);
  if (scene === 'composer') {
    await page.locator('.activity-meta > summary').evaluateAll((summaries) => {
      for (const summary of summaries) {
        if (!summary.parentElement?.open) {
          summary.click();
        }
      }
    });
    await page.waitForTimeout(100);
    await page.locator('.activity-command-detail > summary').evaluateAll((summaries) => {
      for (const summary of summaries) {
        if (!summary.parentElement?.open) {
          summary.click();
        }
      }
    });
    await page.waitForTimeout(100);
    await page.locator('.chat-pane').evaluate((element) => {
      element.scrollTop = 180;
    });
    await page.waitForTimeout(200);
  }
  const metrics = await assertViewport(page);
  await page.screenshot({path: output, fullPage: false});
  console.log(`${path.basename(output)} ${metrics.innerWidth}x${metrics.innerHeight}@${metrics.devicePixelRatio}`);
}

const {chromium} = await import('playwright');

mkdirSync(outputDir, {recursive: true});
rmSync(outputDir, {recursive: true, force: true});
mkdirSync(outputDir, {recursive: true});

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--config', 'client/vite.config.js'], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe']
});

server.stdout.on('data', (chunk) => process.stdout.write(chunk));
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

let browser;
try {
  waitForServer(baseUrl);
  browser = await chromium.launch({
    executablePath: chrome,
    headless: true
  });
  const context = await browser.newContext({
    viewport: viewportSize,
    deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark'
  });
  const page = await context.newPage();

  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({colorScheme: theme});
    for (const [name, scene] of scenes) {
      const output = path.join(outputDir, `real-ui-${name}-${theme}.png`);
      const params = new URLSearchParams({
        scene,
        theme,
        path: '/Users/demo/Projects/CodexMobile/README.md'
      });
      await captureScreenshot(page, `${baseUrl}/demo/screenshots?${params.toString()}`, output, {scene});
      if (!existsSync(output)) {
        throw new Error(`Missing screenshot ${output}`);
      }
    }
  }
  console.log(`Wrote ${scenes.length * 2} real UI screenshots to ${outputDir}`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
