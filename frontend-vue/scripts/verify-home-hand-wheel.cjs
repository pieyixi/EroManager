const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = createRequire(path.join(__dirname, '../package.json'))('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const output = process.env.HAND_QA_OUTPUT || path.join(require('node:os').tmpdir(), 'ero-hand-wheel-qa');
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  try {
    for (const [width, height, theme, count] of [[1920, 1080, 'light', 5], [1366, 768, 'dark', 3], [1280, 720, 'light', 2], [1280, 720, 'dark', 1]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(process.env.HAND_QA_URL || 'http://127.0.0.1:1422');
      await page.waitForFunction(() => {
        const s = document.getElementById('app')?.__vue_app__?.config.globalProperties.$pinia._s;
        return s?.get('library')?.works.length >= 5 && !s.get('library').loading && s.has('homeHand');
      });
      await page.locator('.startup-screen').waitFor({ state: 'hidden' });
      const initial = count > 2 ? 1 : 0;
      const expected = await page.evaluate(({ theme, count, initial }) => {
        document.documentElement.dataset.theme = theme;
        const s = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
        s.get('ui').theme = theme;
        const hand = s.get('homeHand');
        hand.cards = s.get('library').works.slice(0, count).map((work, i) => ({
          key: `media:${work.id}`, source: 'media', id: work.id, title: `Card ${i + 1}`,
          cover: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="${['#b9cde2', '#d5c3dc', '#e9c5cd'][i % 3]}"/><text x="150" y="220" text-anchor="middle" font-size="80">${i + 1}</text></svg>`)}`,
        }));
        hand.select(initial);
        return hand.current.key;
      }, { theme, count, initial });
      await page.waitForTimeout(200);
      const root = page.locator('.home-hand');
      async function hoverMain() {
        const box = await page.locator('.home-hand-card.is-main').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      }
      await hoverMain();
      await page.waitForTimeout(180);
      await hoverMain();
      await page.evaluate(() => {
        window.handWheelFrames = [];
        window.recordHandWheel = true;
        const sample = () => {
          const hand = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('homeHand');
          const root = document.querySelector('.home-hand');
          window.handWheelFrames.push({ selected: hand.current?.key, main: root.querySelector('.home-hand-card.is-main')?.dataset.cardKey,
            changing: root.classList.contains('is-layout-changing'), moving: root.classList.contains('is-moving') });
          if (window.recordHandWheel) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(70);
      assert(await root.evaluate(el => el.classList.contains('is-expanded')), 'first wheel must expand, including a one-card hand');
      await page.screenshot({ path: path.join(output, `${width}-${theme}-${count}-opening.png`) });
      // 连续滚动/触控板余量发生在展开期间，不能积累成之后的切牌。
      for (let i = 0; i < 2; i++) { await hoverMain(); await page.mouse.wheel(0, 120); await page.waitForTimeout(75); }
      await page.waitForFunction(() => !document.querySelector('.home-hand').classList.contains('is-layout-changing'));
      await page.waitForTimeout(80);
      const frames = await page.evaluate(() => { window.recordHandWheel = false; return window.handWheelFrames; });
      assert(frames.length > 2 && frames.some(f => f.changing), 'must sample actual opening frames');
      assert(frames.every(f => f.selected === expected && f.main === expected && !f.moving), 'opening wheel must retain the selected and visibly central card throughout every frame');
      await page.screenshot({ path: path.join(output, `${width}-${theme}-${count}-expanded.png`) });
      await hoverMain();
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(660);
      const selected = () => page.evaluate(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('homeHand').activeIndex);
      assert.equal(await selected(), count === 1 ? initial : initial + 1, 'fresh wheel after opening must advance exactly once');
      if (count > 1) {
        await hoverMain(); await page.mouse.wheel(0, -120); await page.waitForTimeout(660);
        assert.equal(await selected(), initial, 'reverse wheel must retain normal carousel behavior');
      }
      await root.focus();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1150);
      assert(!await root.evaluate(el => el.classList.contains('is-expanded')), 'Escape must close the focused hand before reopening');
      await hoverMain(); await page.mouse.wheel(0, -120);
      await page.waitForTimeout(760);
      assert.equal(await selected(), initial, 'reopening in reverse direction must also expand without changing selection');
      assert(await root.evaluate(el => el.classList.contains('is-expanded')));
      assert.deepEqual(errors, []);
      results.push({ width, height, theme, count, frames: frames.length });
      console.log(`PASS ${width}x${height} ${theme}, ${count} cards: opening-only wheel, no frame switches, bidirectional cycling and reopening`);
      await page.close();
    }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(results, null, 2));
    console.log(`Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
