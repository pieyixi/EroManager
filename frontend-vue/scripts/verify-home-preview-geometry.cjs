const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

(async () => {
  const browser = await chromium.launch();
  let cases = 0;
  try {
    for (const [width, height, count] of [[1920, 1080, 1], [1366, 768, 3], [1280, 720, 2]]) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(process.env.HAND_QA_URL || 'http://127.0.0.1:1422');
      await page.waitForFunction(() => {
        const home = document.getElementById('app')?.__vue_app__?.config.globalProperties.$pinia._s.get('home');
        return home?.media.current && home?.book.current && home.media.phase === 'idle' && home.book.phase === 'idle';
      });
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const mode of ['double', 'refill']) {
        await page.evaluate(({count, mode}) => {
          const pinia = document.getElementById('app').__vue_app__.config.globalProperties.$pinia;
          const home = pinia._s.get('home');
          const ids = pinia._s.get('ehLibrary').galleries.map(gallery => gallery.gid);
          const image = (color, width, height) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`);
          const cover = image('#aabbd0', 800, 1200);
          home.book.current = { id: ids[0], title: 'before', cover, previews: [0, 1, 2].map(index => ({ key: `old-${mode}-${index}`, label: 'old', image: image('#bcaadc', 800, 1200), aspectRatio: 2 / 3 })) };
          home.pickBook = async () => ({ id: ids[1], title: 'after', cover, previews: [[1200, 800], [800, 1200], [800, 800]].slice(0, count).map(([w, h], index) => ({ key: `new-${mode}-${index}`, label: 'new', image: image(['#e3aabc', '#abd4bf', '#b2c4e5'][index], w, h) })) });
          window.geometryFrames = [];
          window.recordGeometry = true;
          const tick = () => {
            const rail = document.querySelector('.home-draw-book .home-draw-previews');
            window.geometryFrames.push({ phase: home.book.phase, items: [...rail.querySelectorAll('figure')].map(figure => {
              const image = figure.querySelector('img');
              const bounds = figure.getBoundingClientRect();
              return { label: image.alt, ratio: Number(getComputedStyle(figure).getPropertyValue('--preview-ratio')),
                natural: image.naturalWidth / image.naturalHeight, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
            }) });
            if (window.recordGeometry) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }, {count, mode});
        await page.waitForTimeout(40);
        if (mode === 'double') await page.locator('.home-draw-book .home-draw-cover').dblclick();
        else {
          const cover = await page.locator('.home-draw-book .home-draw-cover').boundingBox();
          const target = await page.locator('.home-hand-drop-zone').boundingBox();
          await page.mouse.move(cover.x + cover.width / 2, cover.y + cover.height / 2);
          await page.mouse.down();
          await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 14 });
          await page.mouse.up();
        }
        await page.waitForFunction(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('home').book.phase === 'settling');
        await page.screenshot({ path: path.join(os.tmpdir(), `ero-preview-geometry-${width}-${theme}-${mode}-first.png`) });
        await page.waitForFunction(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('home').book.phase === 'idle');
        await page.waitForTimeout(350);
        const frames = await page.evaluate(() => { window.recordGeometry = false; return window.geometryFrames; });
        const incoming = frames.filter(frame => frame.items[0]?.label === 'new');
        assert(incoming.length > 8, 'missing first-frame geometry samples');
        assert.equal(incoming[0].phase, 'settling');
        assert(incoming.every(frame => frame.items.length === count));
        for (const frame of incoming) for (const [index, item] of frame.items.entries()) {
          assert(Math.abs(item.ratio - item.natural) < .0001, 'first frame used a fallback aspect ratio');
          for (const axis of ['x', 'y', 'width', 'height']) assert(Math.abs(item[axis] - incoming.at(-1).items[index][axis]) < .1, `unexpected ${axis} movement after reveal`);
        }
        assert(frames.filter(frame => ['closing', 'tucking', 'waiting', 'opening'].includes(frame.phase)).every(frame => frame.items.every(item => item.label === 'old')), 'preview switched early');
        await page.screenshot({ path: path.join(os.tmpdir(), `ero-preview-geometry-${width}-${theme}-${mode}-settled.png`) });
        await page.locator('.home-draw-book .home-draw-preview').first().hover();
        await page.waitForTimeout(550);
        const bounds = await page.locator('.home-draw-book .home-draw-preview').evaluateAll(items => items.map(item => { const r = item.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
        for (let index = 1; index < bounds.length; index++) assert(bounds[index].top - bounds[index - 1].bottom >= 11.8, 'hover previews overlap');
        await page.mouse.move(80, 70);
        await page.waitForTimeout(500);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        cases++;
        console.log(`PASS ${width} ${theme} ${mode}, ${count} previews: true first-frame ratios, no geometry drift, hover preserved`);
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(`PASS ${cases} book-preview geometry cases`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
