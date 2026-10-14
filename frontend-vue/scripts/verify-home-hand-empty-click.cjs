const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = createRequire(path.join(__dirname, '../package.json'))('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const output = path.join(require('node:os').tmpdir(), 'ark-hand-empty-click-qa');
  fs.mkdirSync(output, { recursive: true });
  const position = () => page.locator('.home-hand-card').first().evaluate(card => Number(card.dataset.virtualIndex) - Number(card.dataset.slot));
  try {
    await page.goto(process.env.HAND_QA_URL || 'http://127.0.0.1:1422');
    await page.waitForFunction(() => document.getElementById('app').__vue_app__?.config.globalProperties.$pinia._s.get('library')?.works.length >= 9);
    const cases = process.env.HAND_QA_REPRO ? [[1920, 1080, 'light', 3]] :
      [[1920, 1080], [1366, 768], [1280, 720]].flatMap(([w, h]) => ['light', 'dark'].flatMap(theme => [2, 3, 9].map(count => [w, h, theme, count])));
    for (const [width, height, theme, count] of cases) {
      await page.setViewportSize({ width, height });
      await page.evaluate(({ theme, count }) => {
        const stores = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
        document.documentElement.dataset.theme = theme;
        stores.get('ui').theme = theme;
        const hand = stores.get('homeHand');
        hand.cards = stores.get('library').works.slice(0, count).map((work, i) => ({ key: `media:${work.id}`, source: 'media', id: work.id, title: `Card ${i + 1}`, cover: '' }));
        hand.activeIndex = 0;
      }, { theme, count });
      await page.waitForTimeout(550);
      await page.locator('.home-hand').focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(750);
      const root = await page.locator('.home-hand').boundingBox();
      const x = root.x + root.width * .82, y = root.y + 8;
      assert(await page.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return hit?.closest('.home-hand') && !hit.closest('.home-hand-card');
      }, { x, y }), 'reproduction point must hit the blank hand region, not a card or outside backdrop');
      for (const [delay, direction] of [[70, 1], [160, -1], [320, 1]]) {
        const before = Math.round(await position());
        const expected = count === 2 ? (before + direction + count) % count : before + direction;
        await page.keyboard.press(direction > 0 ? 'ArrowRight' : 'ArrowLeft');
        await page.waitForTimeout(delay);
        await page.mouse.click(x, y);
        const interrupted = await position();
        await page.waitForTimeout(750);
        const settled = await position();
        await page.screenshot({ path: path.join(output, `${width}-${theme}-${count}.png`), clip: root });
        console.log(JSON.stringify({ width, theme, count, delay, interrupted, settled, expected }));
        assert(Math.abs(settled - expected) < .001, 'blank click interrupted carousel but did not resume its intended destination');
        assert.equal(await page.locator('.home-hand-card.is-main').count(), 1);
        assert.equal(await page.locator('.home-hand.is-moving').count(), 0);
        assert.equal(await page.evaluate(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').activePage), 'page-home');
        // 点击后仍能继续切换，不能遗留鼠标捕获或未清理的手势。
        await page.mouse.wheel(0, 130);
        await page.waitForTimeout(650);
        const next = count === 2 ? (expected + 1) % count : expected + 1;
        assert(Math.abs(await position() - next) < .001);
      }
      if (width === 1920 && theme === 'light' && count === 9) {
        const before = Math.round(await position());
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(90);
        for (let click = 0; click < 3; click++) { await page.mouse.click(x, y); await page.waitForTimeout(40); }
        await page.waitForTimeout(750);
        assert(Math.abs(await position() - before - 1) < .001, 'repeated blank clicks must retain the same intended destination');
        await page.mouse.down();
        await page.waitForTimeout(900);
        assert.equal(await page.locator('.home-hand-card.is-hold-ready, .home-hand-card.is-pressing').count(), 0, 'holding blank space must not arm removal');
        await page.mouse.up();
        const start = Math.round(await position());
        await page.mouse.down();
        await page.mouse.move(x - root.width * .78 * .7, y, { steps: 10 });
        await page.waitForTimeout(120);
        await page.mouse.up();
        await page.waitForTimeout(750);
        assert(Math.abs(await position() - start - 1) < .001, 'horizontal drag beginning on blank space must remain functional');
        console.log('PASS repeated blank clicks, blank long-press, blank-origin horizontal drag');
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1200);
      console.log(`PASS ${width}x${height} ${theme}, ${count} cards: blank clicks during forward/reverse cycling resume and allow the next gesture`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
