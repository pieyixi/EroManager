const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const base = process.env.ERO_PREVIEW_URL || 'http://127.0.0.1:1422/';
const output = process.env.ERO_PLAYER_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'ero-player-transparency-'));
fs.mkdirSync(output, { recursive: true });
const pixelCheck = String.raw`
from PIL import Image
import json,sys
case=json.loads(sys.argv[1]); im=Image.open(case['file']).convert('RGBA'); r=case['stage']
points=[(int(r['x']+r['width']*x),int(r['y']+r['height']*y)) for x in [.15,.35,.65,.85] for y in [.2,.5,.8]]
print(json.dumps([{'at':p,'rgba':im.getpixel(p)} for p in points]))
`;

function pixelSamples(file, stage) {
  const result = spawnSync('D:/Envirnment/python/python312/python.exe', ['-c', pixelCheck, JSON.stringify({ file, stage })], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

(async () => {
  const browser = await chromium.launch();
  const reports = [];
  try {
    for (const [width, height] of [[1920, 1080], [1366, 768], [1280, 720]]) {
      for (const initial of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width, height } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(theme => {
          localStorage.setItem('media-library-theme', theme);
          localStorage.setItem('media-library-theme-mode', theme);
          localStorage.setItem('ero-browser-preferences-v1', JSON.stringify({ theme }));
        }, initial);
        // 在应用样式尚未加载时也保留深浅开屏底色，防止修复引入首帧闪白。
        const script = '**/src/main.ts';
        await page.route(script, route => route.fulfill({ contentType: 'application/javascript', body: '' }));
        await page.goto(base);
        const startup = await page.evaluate(() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor]);
        assert.deepEqual(startup, Array(2).fill(initial === 'dark' ? 'rgb(30, 32, 37)' : 'rgb(250, 250, 250)'));
        await page.unroute(script);
        await page.reload();
        await page.locator('.startup-screen').waitFor({ state: 'detached' });
        await page.evaluate(() => {
          const stores = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
          stores.get('navigation').showPage('page-player');
          Object.assign(stores.get('player'), { nativeVisible: true, videoLoading: false, hint: '' });
        });
        await page.waitForTimeout(1100);
        for (const mode of ['initial', 'soft', 'reveal']) {
          if (mode !== 'initial') {
            await page.evaluate(mode => {
              const ui = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ui');
              ui.setTheme(ui.theme === 'dark' ? 'light' : 'dark', { x: 32, y: 640 }, mode);
            }, mode);
            await page.waitForTimeout(800);
          }
          const theme = await page.evaluate(() => document.documentElement.dataset.theme);
          for (const fullscreen of [false, true]) {
            await page.evaluate(fullscreen => {
              const player = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player');
              player.fullscreen = fullscreen;
              player.sidebarCollapsed = fullscreen;
            }, fullscreen);
            await page.waitForTimeout(300);
            await page.evaluate(async () => {
              const { playerCommands } = await import('/src/features/player/commands.ts');
              playerCommands.scheduleBoundsSync();
            });
            await page.waitForTimeout(300);
            const stage = await page.locator('#mpvStage').boundingBox();
            assert(stage.width > 600 && stage.height > 300);
            const file = path.join(output, `${width}-${initial}-${mode}-${theme}-${fullscreen ? 'fullscreen' : 'window'}.png`);
            await page.screenshot({ path: file, omitBackground: true });
            const samples = pixelSamples(file, stage);
            assert(samples.every(sample => sample.rgba[3] === 0), JSON.stringify({ width, initial, mode, theme, fullscreen, samples }));
            reports.push({ width, height, initial, mode, theme, fullscreen, file, transparentSamples: samples.length });
          }
        }
        // 首帧未准备好时仍有不透明占位，不能通过让整个界面透明绕过遮罩问题。
        await page.evaluate(() => {
          const player = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player');
          player.fullscreen = false; player.videoLoading = true;
        });
        await page.waitForTimeout(300);
        const loading = path.join(output, `${width}-${initial}-loading.png`);
        await page.screenshot({ path: loading, omitBackground: true });
        assert(pixelSamples(loading, await page.locator('#mpvStage').boundingBox()).every(sample => sample.rgba[3] === 255));
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(reports, null, 2));
    console.log(`PASS ${reports.length} player transparency cases, both startup themes, soft/reveal switches, window/fullscreen, three sizes; startup colors and loading placeholders retained. Evidence: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
