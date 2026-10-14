const { createRequire } = require('node:module');
const path = require('node:path');
const { chromium } = createRequire(path.join(__dirname, '../package.json'))('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(process.env.HAND_QA_URL || 'http://127.0.0.1:1422');
    await page.waitForFunction(() => {
      const s = document.getElementById('app')?.__vue_app__?.config.globalProperties.$pinia._s;
      return s?.get('library')?.works.length && !s.get('library').loading && !s.get('ehLibrary').loading;
    });
    for (const [width, height, theme] of [[1920,1080,'light'], [1920,1080,'dark'], [1366,768,'light'], [1366,768,'dark'], [1280,720,'light'], [1280,720,'dark']]) {
      await page.setViewportSize({ width, height });
      for (const rank of [0, 3, 6]) {
        await page.mouse.move(100, 100);
        await page.evaluate(theme => {
          document.documentElement.dataset.theme = theme;
          const s = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
          const hand = s.get('homeHand');
          hand.cards = s.get('library').works.slice(0, 9).map((work, index) => ({ key: `media:${work.id}`, source: 'media', id: work.id, title: `Card ${index}`,
            cover: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#c7d9eb"/><text x="300" y="430" text-anchor="middle" font-size="110" fill="#435365">${index}</text></svg>`)}` }));
          hand.activeIndex = 0;
        }, theme);
        await page.waitForTimeout(550);
        const main = page.locator('.home-hand-card.is-main');
        const r = await main.boundingBox();
        await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
        await page.waitForTimeout(600);
        const point = await page.locator('.home-hand-card').nth(rank).evaluate(element => {
          const r = element.getBoundingClientRect();
          for (let y = r.top + 6; y < r.bottom - 6; y += 4) {
            for (let x = r.left + 3; x < r.right - 3; x += 4) {
              if (element.contains(document.elementFromPoint(x, y))) return { x, y, key: element.dataset.cardKey };
            }
          }
          return null;
        });
        assert(point, 'every fanned card must have a clickable exposed strip');
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForTimeout(750);
        assert.equal(await page.locator('.home-hand-card.is-main').getAttribute('data-card-key'), point.key);
        assert.equal(await page.evaluate(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('homeHand').current.key), point.key);
        assert.equal(await page.locator('#page-home.active').count(), 1, 'selecting a fanned card must expand it rather than open details');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1200);
        assert.equal(await page.locator('.home-hand-card.is-main').getAttribute('data-card-key'), point.key);
      }
      console.log(`PASS ${width}x${height} ${theme}: exposed left/middle/right fan cards become main on click and remain main after gathering`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
