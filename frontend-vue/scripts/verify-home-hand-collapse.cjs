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
  const output = process.env.HAND_QA_OUTPUT || path.join(require('node:os').tmpdir(), 'ark-hand-collapse-qa');
  fs.mkdirSync(output, { recursive: true });
  try {
    await page.goto(process.env.HAND_QA_URL || 'http://127.0.0.1:1422');
    await page.waitForFunction(() => {
      const stores = document.getElementById('app')?.__vue_app__?.config.globalProperties.$pinia._s;
      return stores?.get('library')?.works.length && !stores.get('library').loading && !stores.get('ehLibrary').loading;
    });
    const cases = [
      ...[[1920, 1080], [1366, 768], [1280, 720]].flatMap(size => ['light', 'dark'].map(theme => ({ size, theme, count: 9 }))),
      ...[1, 2, 3].map(count => ({ size: [1280, 720], theme: 'light', count })),
    ];
    for (const { size, theme, count } of cases) {
      await page.setViewportSize({ width: size[0], height: size[1] });
      await page.mouse.move(100, 100);
      await page.evaluate(({ theme, count }) => {
        document.documentElement.dataset.theme = theme;
        const stores = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
        const hand = stores.get('homeHand');
        hand.cards = stores.get('library').works.slice(0, count).map((work, index) => ({
          key: `media:${work.id}`, source: 'media', id: work.id, title: `Card ${index + 1}`,
          cover: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="${['#b9cde2', '#d5c3dc', '#e9c5cd'][index % 3]}"/><circle cx="430" cy="200" r="180" fill="#fff" opacity=".15"/><text x="300" y="430" text-anchor="middle" font-size="100" fill="#435365">${index + 1}</text></svg>`)}`,
        }));
        hand.activeIndex = 0;
      }, { theme, count });
      await page.waitForTimeout(550);
      // 在浏览器同一事件/首帧中采样，避免编译负载或跨进程往返把“首帧”拖成动画中段。
      await page.evaluate(() => {
        window.openingSample = new Promise(resolve => {
          document.querySelector('.home-hand').addEventListener('keydown', () => {
            const sourceMain = document.querySelector('.home-hand-card.is-main').getBoundingClientRect().toJSON();
            requestAnimationFrame(() => resolve({ sourceMain,
              firstOpen: document.querySelector('.home-hand-card.is-main').getBoundingClientRect().toJSON(),
              born: document.querySelector('.home-hand-card[data-slot="1"]')?.getBoundingClientRect().toJSON() }));
          }, { once: true, capture: true });
        });
      });
      await page.locator('.home-hand').focus();
      await page.keyboard.press('Enter');
      const { sourceMain, firstOpen, born } = await page.evaluate(() => window.openingSample);
      assert(Math.abs(firstOpen.x - sourceMain.x) < 4 && Math.abs(firstOpen.width - sourceMain.width) < 4, 'opening must start at the actual old pose, not the destination');
      if (count === 9) {
        assert(Math.abs((born.x + born.width / 2) - (sourceMain.x + sourceMain.width / 2)) < 24, 'new side card must start underneath the original stack');
      }
      await page.waitForTimeout(740);
      if (count === 9) {
        await page.locator('.home-hand').hover();
        await page.mouse.wheel(0, -100);
        await page.waitForTimeout(700);
      }
      await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.home-hand-card')];
        window.trackedCards = cards.filter(card => Number(getComputedStyle(card).opacity) > .1).map(card => ({
          key: card.dataset.cardKey, element: card, start: card.getBoundingClientRect().toJSON(),
        }));
        window.mainCard = document.querySelector('.home-hand-card.is-main');
        window.collapseFrames = [];
        window.collapseStart = performance.now();
        window.recordCollapse = true;
        function sample() {
          const rect = window.mainCard.getBoundingClientRect();
          const boxes = [...document.querySelectorAll('.home-hand-card')].map(card => card.getBoundingClientRect());
          window.collapseFrames.push({ width: rect.width, left: rect.left, connected: window.mainCard.isConnected,
            elapsed: performance.now() - window.collapseStart,
            spread: Math.max(...boxes.map(box => box.left)) - Math.min(...boxes.map(box => box.left)),
            backPositions: [...document.querySelectorAll('.home-hand-card')].map(card => ({ key: card.dataset.cardKey, left: card.getBoundingClientRect().left })),
          });
          if (window.recordCollapse) requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      await page.keyboard.press('Escape');
      const firstClose = await page.locator('.home-hand-card.is-main').boundingBox();
      const originalRect = await page.evaluate(() => window.trackedCards.find(card => card.element === window.mainCard).start);
      assert(Math.abs(firstClose.x - originalRect.x) < 4 && Math.abs(firstClose.width - originalRect.width) < 4, 'closing must keep the main card in place while sides gather');
      await page.waitForTimeout(100);
      assert(await page.evaluate(() => window.trackedCards.every(card => card.element.isConnected)), 'all visible cards must survive the gathering motion');
      assert(await page.evaluate(() => document.querySelector('.home-hand-card.is-main') === window.mainCard), 'main card must keep its DOM identity');
      if (count === 9) await page.screenshot({ path: path.join(output, `${size.join('x')}-${theme}-gathering.png`) });
      await page.waitForTimeout(1100);
      const result = await page.evaluate(() => {
        window.recordCollapse = false;
        return { frames: window.collapseFrames, count: document.querySelectorAll('.home-hand-card').length,
          changing: document.querySelector('.home-hand').classList.contains('is-layout-changing'),
          overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
        };
      });
      assert(result.frames.every(frame => frame.connected));
      assert(new Set(result.frames.map(frame => Math.round(frame.width))).size >= 4, 'shrink must pass through multiple intermediate sizes');
      const last = result.frames.slice(-4).map(frame => frame.width);
      assert(Math.max(...last) - Math.min(...last) < 1, `finishing must not jump when temporary styles are removed: ${JSON.stringify(last)}`);
      const handoff = result.frames.filter(frame => frame.elapsed > 950);
      for (let index = 1; index < handoff.length; index++) {
        for (const card of handoff[index].backPositions) {
          const previous = handoff[index - 1].backPositions.find(old => old.key === card.key);
          if (previous) assert(Math.abs(card.left - previous.left) < 1.5, `back cards must not jump or animate again during style handoff: ${JSON.stringify({ card, previous, time: handoff[index].elapsed, before: handoff[index - 1].elapsed })}`);
        }
      }
      assert.equal(result.count, Math.min(7, count));
      assert.equal(result.changing, false);
      assert.equal(result.overflow, false);
      if (count === 9) {
        assert(result.frames.some(frame => frame.elapsed > 500 && frame.spread < 2), 'all cards must gather into one aligned stack before fanning');
        assert(result.frames.at(-1).spread > 5, 'the aligned stack should only fan slightly after landing');
      }
      if (count === 9) await page.screenshot({ path: path.join(output, `${size.join('x')}-${theme}-stack.png`) });
      if (count === 3 || (count === 9 && size[0] === 1280 && theme === 'light')) {
        await page.locator('.home-hand').focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(190);
        const beforeReverse = await page.locator('.home-hand-card.is-main').boundingBox();
        await page.keyboard.press('Escape');
        const afterReverse = await page.locator('.home-hand-card.is-main').boundingBox();
        assert(Math.abs(afterReverse.x - beforeReverse.x) < 5 && Math.abs(afterReverse.width - beforeReverse.width) < 5, 'reversing midway must continue from the actual current pose');
        await page.waitForTimeout(1150);
        for (const [delay, key] of [[50, 'ArrowRight'], [200, 'ArrowLeft'], [400, 'ArrowRight'], [540, 'ArrowLeft']]) {
          await page.locator('.home-hand').focus();
          await page.keyboard.press('Enter');
          await page.waitForTimeout(740);
          await page.keyboard.press(key);
          await page.waitForTimeout(delay);
          const expected = await page.evaluate(() => {
            const front = [...document.querySelectorAll('.home-hand-card')]
              .sort((a, b) => Math.abs(Number(a.dataset.slot)) - Math.abs(Number(b.dataset.slot)))[0];
            const before = { key: front.dataset.cardKey, rect: front.getBoundingClientRect().toJSON() };
            document.querySelector('.home-hand-backdrop').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            return before;
          });
          const main = page.locator('.home-hand-card.is-main');
          assert.equal(await main.getAttribute('data-card-key'), expected.key, 'outside click must retain the visually nearest main, not the old selection');
          const first = await main.boundingBox();
          assert(Math.abs(first.x - expected.rect.x) < 5 && Math.abs(first.width - expected.rect.width) < 5, 'interrupting the carousel must preserve the actual screen pose');
          await page.waitForTimeout(1150);
          assert.equal(await main.getAttribute('data-card-key'), expected.key);
          assert(await main.evaluate(element => { const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), 'the selected card must be physically at the top after gathering');
        }
        console.log(`PASS ${count}-card interruption: reverse while opening, outside click at 50/200/400/540ms, correct top card and continuous pose`);
      }
      console.log(`PASS ${size.join('x')} ${theme}, ${count} cards: ${result.frames.length} frames; retained visible cards, continuous shrink, stack cleanup`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
