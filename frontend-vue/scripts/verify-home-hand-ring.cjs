const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = createRequire(path.join(__dirname, '../package.json'))('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const output = process.env.HAND_QA_OUTPUT || path.join(require('node:os').tmpdir(), 'ark-hand-ring-qa');
  fs.mkdirSync(output, { recursive: true });
  try {
    await page.goto(process.env.HAND_QA_URL || 'http://127.0.0.1:1422');
    await page.waitForFunction(() => {
      const s = document.getElementById('app')?.__vue_app__?.config.globalProperties.$pinia._s;
      return s?.get('library')?.works.length && !s.get('library').loading && !s.get('ehLibrary').loading;
    });
    for (const [width, height, theme, count] of [[1920, 1080, 'light', 9], [1920, 1080, 'dark', 9], [1366, 768, 'light', 9], [1366, 768, 'dark', 9], [1280, 720, 'light', 9], [1280, 720, 'dark', 9], [1280, 720, 'light', 3]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(({ count, theme }) => {
        document.documentElement.dataset.theme = theme;
        const s = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
        s.get('ui').theme = theme;
        const hand = s.get('homeHand');
        hand.cards = s.get('library').works.slice(0, count).map((work, i) => ({ key: `media:${work.id}`, source: 'media', id: work.id, title: `Card ${i + 1}`,
          cover: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="${['#b9cde2', '#d5c3dc', '#e9c5cd'][i % 3]}"/><text x="300" y="430" text-anchor="middle" font-size="110" fill="#435365">${i + 1}</text></svg>`)}` }));
        hand.activeIndex = 0;
      }, { count, theme });
      await page.waitForTimeout(550);
      await page.locator('.home-hand-card.is-main').click();
      await page.waitForTimeout(740);
      await page.evaluate(() => {
        window.original = document.querySelector('.home-hand-card.is-main');
        window.originalKey = window.original.dataset.cardKey;
        window.ringFrames = [];
        window.recordRing = true;
        const sample = () => {
          const cards = [...document.querySelectorAll('.home-hand-card')];
          const card = cards.find(card => card.dataset.cardKey === window.originalKey);
          const faces = cards.map(card => ({ key: card.dataset.cardKey, slot: Number(card.dataset.slot),
            layer: Number(getComputedStyle(card).zIndex), rect: card.getBoundingClientRect() }));
          const exposed = face => {
            let visible = 0;
            for (let iy = 1; iy < 12; iy++) for (let ix = 1; ix < 12; ix++) {
              const x = face.rect.left + face.rect.width * ix / 12;
              const y = face.rect.top + face.rect.height * iy / 12;
              if (!faces.some(other => other.layer > face.layer && x > other.rect.left && x < other.rect.right && y > other.rect.top && y < other.rect.bottom)) visible++;
            }
            return visible;
          };
          window.ringFrames.push({ count: cards.length, unique: new Set(cards.map(card => card.dataset.cardKey)).size,
            opaque: cards.every(card => Number(getComputedStyle(card).opacity) === 1 && getComputedStyle(card).visibility === 'visible'),
            rearVisible: faces.some(face => Math.abs(face.slot) > 1.25 && exposed(face) > 0),
            recycledCovered: faces.filter(face => Math.abs(face.slot) > 2.98).every(face => exposed(face) === 0),
            original: card ? { same: card === window.original, x: Number.parseFloat(card.style.getPropertyValue('--hand-x')), scale: Number(card.style.getPropertyValue('--hand-scale')), layer: Number(card.style.zIndex) } : null });
          if (window.recordRing) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(650);
      assert.equal(await page.evaluate(() => Number.parseFloat(window.original.style.getPropertyValue('--hand-x'))), -78);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(190);
      await page.screenshot({ path: path.join(output, `${width}-${theme}-${count}-rear-arc.png`) });
      await page.waitForTimeout(450);
      // 完整环回后，原作品必须从另一边回到主位。
      if (width === 1920 && theme === 'light' || count === 3) {
        for (let index = 2; index < count; index++) {
          await page.keyboard.press('ArrowRight');
          await page.waitForTimeout(650);
        }
        assert.equal(await page.locator('.home-hand-card.is-main').getAttribute('data-card-key'), await page.evaluate(() => window.originalKey));
      }
      const frames = await page.evaluate(() => { window.recordRing = false; return window.ringFrames; });
      assert(frames.every(frame => frame.opaque && frame.unique === frame.count && frame.count <= 7));
      assert(frames.some(frame => frame.rearVisible), 'rear faces must actually be exposed during the orbit, not fully tucked behind the front cards');
      assert(frames.every(frame => frame.recycledCovered), 'node recycling must happen only when the entire rear face is geometrically covered, regardless of pointer-events');
      assert(frames.some(frame => frame.original && Math.abs(frame.original.x) < 75 && frame.original.scale < .69), 'side card must turn inward and move to deeper layers');
      if (count === 3) assert(frames.every(frame => frame.count === 3 && frame.original?.same), 'three-card ring must keep three actual nodes through the rear seam');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
      console.log(`PASS ${width}x${height} ${theme}, ${count} cards: ${frames.length} frames, visible opaque rear orbit, fully covered recycle, unique bounded nodes`);
      if (width === 1920 && theme === 'light' && count === 9) {
        const main = page.locator('.home-hand-card.is-main');
        const rect = await main.boundingBox();
        const spacing = await main.evaluate(card => card.offsetWidth * .78);
        const root = await page.locator('.home-hand').boundingBox();
        const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (const phase of [.25, .5, .75, 1.25, 1.5, 1.75, 2.25, 2.5, 2.75, 3.25]) {
          await page.mouse.move(x - spacing * phase, y);
          await page.waitForTimeout(40);
          await page.screenshot({ path: path.join(output, `orbit-${phase}.png`), clip: root });
        }
        await page.mouse.up();
        await page.waitForTimeout(750);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1200);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
