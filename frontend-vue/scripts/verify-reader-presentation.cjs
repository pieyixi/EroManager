const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = createRequire(path.join(__dirname, '../package.json'))('playwright');
const assert = require('node:assert/strict');

(async () => {
  const native = process.argv.includes('--native');
  const browser = native ? await chromium.connectOverCDP('http://127.0.0.1:9224') : await chromium.launch({ headless: true });
  const page = native ? browser.contexts()[0].pages()[0] : await browser.newPage();
  try {
    if (!native) await page.goto(process.env.READER_QA_URL || 'http://127.0.0.1:1422');
    await page.waitForFunction(() => !!document.getElementById('app')?.__vue_app__);
    if (native && process.argv.includes('--real')) {
      await page.reload();
      await page.waitForFunction(() => !!document.getElementById('app')?.__vue_app__);
      const count = await page.evaluate(async () => {
        const stores = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
        const library = stores.get('ehLibrary');
        await library.load();
        const gallery = library.galleries.find(gallery => gallery.pages >= 20);
        if (!gallery) throw new Error('No suitable local gallery for read-only QA');
        await stores.get('ehReader').open(gallery);
        return stores.get('ehReader').pages.length;
      });
      const ready = () => page.waitForFunction(() => {
        const r = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehReader');
        const images = [...document.querySelectorAll('.reader-frame:not(.preparing) img')];
        const pages = r.direction === 'rtl' ? [...r.currentSpread.pages].reverse() : r.currentSpread.pages;
        return images.length === pages.length && images.every((image, index) => image.complete && image.naturalWidth > 0 && image.src === r.imageCache[pages[index].path]);
      });
      await ready();
      await page.evaluate(() => {
        window.realSamples = { total: 0, empty: 0, incomplete: 0, badLandscape: 0 };
        window.sampling = true;
        const sample = () => {
          const images = [...document.querySelectorAll('.reader-frame:not(.preparing) img')];
          const stats = window.realSamples;
          stats.total++;
          if (!images.length) stats.empty++;
          if (images.some(image => !image.complete || !image.naturalWidth)) stats.incomplete++;
          if (images.some(image => image.naturalWidth > image.naturalHeight) && (images.length !== 1 || !images[0].classList.contains('landscape'))) stats.badLandscape++;
          if (window.sampling) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      for (let index = 0; index < 16; index++) {
        await page.evaluate(back => {
          const r = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehReader');
          back ? r.previous() : r.next();
        }, index >= 12);
        await ready();
      }
      const stats = await page.evaluate(() => { window.sampling = false; return window.realSamples; });
      assert(stats.total > 0);
      assert.equal(stats.empty + stats.incomplete + stats.badLandscape, 0);
      console.log(`PASS real local gallery (${count} pages), 16 turns: ${JSON.stringify(stats)}`);
      return;
    }
    for (const size of native ? [[1360, 900]] : [[1920, 1080], [1366, 768], [1280, 720]]) {
      if (!native) await page.setViewportSize({ width: size[0], height: size[1] });
      await page.evaluate(() => {
        const stores = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
        const r = stores.get('ehReader');
        r.loadGeneration++;
        r.loadPaths = async () => {};
        r.prefetchNearby = async () => {};
        r.pages = Array.from({ length: 7 }, (_, index) => ({ index, path: `fixture-${index}`, width: 0, height: 0 }));
        const image = index => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${index === 2 ? 1600 : 900}" height="${index === 2 ? 900 : 1400}"><rect width="100%" height="100%" fill="${index === 2 ? '#e4ecf5' : '#f5f2eb'}"/><text x="50%" y="50%" text-anchor="middle" font-size="70" fill="#526174">PAGE ${index}</text></svg>`)}`;
        window.fixtureImage = image;
        r.imageCache = { 'fixture-0': image(0) };
        r.gallery = { gid: 1, title: '阅读显示缓冲验证' };
        r.loading = false; r.error = ''; r.spreadIndex = 0; r.pairOffset = 1;
        r.zoom = 100; r.pageMode = 'double'; r.direction = 'rtl'; r.toolsVisible = false;
        stores.get('navigation').showPage('page-eh-reader');
      });
      const visible = () => page.locator('.reader-frame:not(.preparing) img').evaluateAll(images => images.map(image => ({
        index: Number(decodeURIComponent(image.src).match(/PAGE (\d)/)?.[1]),
        loaded: image.complete && image.naturalWidth > 0,
        landscape: image.classList.contains('landscape'),
        width: image.getBoundingClientRect().width,
      })));
      await page.waitForFunction(() => document.querySelectorAll('.reader-frame:not(.preparing) img').length === 1);
      assert.equal((await visible())[0].index, 0);
      await page.evaluate(() => {
        window.framesSeen = [];
        window.sampling = true;
        const sample = () => {
          const images = [...document.querySelectorAll('.reader-frame:not(.preparing) img')];
          window.framesSeen.push(images.map(image => ({ src: image.src, width: image.naturalWidth, ready: image.complete && image.naturalWidth > 0, landscape: image.classList.contains('landscape') })));
          if (window.sampling) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehReader').next();
      });
      await page.waitForTimeout(180);
      assert.equal((await visible())[0].index, 0, 'old cover survives missing image data');
      await page.evaluate(() => {
        const r = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehReader');
        const original = HTMLImageElement.prototype.decode;
        window.restoreDecode = () => { HTMLImageElement.prototype.decode = original; };
        const gate = new Promise(resolve => { window.releaseDecode = resolve; });
        HTMLImageElement.prototype.decode = async function () {
          await original.call(this);
          if (this.isConnected && this.src.includes('PAGE%201')) await gate;
        };
        r.imageCache = Object.fromEntries(r.pages.map(p => [p.path, window.fixtureImage(p.index)]));
      });
      await page.waitForFunction(() => !!document.querySelector('.reader-frame.preparing img'));
      await page.waitForTimeout(180);
      assert.equal((await visible())[0].index, 0, 'old cover survives delayed DOM decode');
      await page.evaluate(() => { window.releaseDecode(); window.restoreDecode(); });
      await page.waitForFunction(() => document.querySelector('.reader-frame:not(.preparing) img')?.src.includes('PAGE%201'));
      assert.deepEqual((await visible()).map(p => p.index), [1], 'landscape neighbor must not pair with portrait');
      await page.mouse.move(600, 350);
      await page.mouse.wheel(0, 100);
      await page.waitForFunction(() => document.querySelector('.reader-frame:not(.preparing) img')?.src.includes('PAGE%202'));
      const landscape = await visible();
      assert.equal(landscape.length, 1);
      assert.equal(landscape[0].landscape, true);
      assert(landscape[0].width > 700);
      // 同一事件循环内连续翻页，旧目标不得覆盖最后一次请求。
      await page.evaluate(() => {
        const r = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehReader');
        r.next(); r.previous(); r.next();
      });
      await page.waitForFunction(() => document.querySelectorAll('.reader-frame:not(.preparing) img').length === 2);
      assert.deepEqual((await visible()).map(p => p.index), [4, 3]);
      await page.waitForTimeout(100);
      await page.evaluate(() => {
        const r = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehReader');
        r.imageCache = { ...r.imageCache, 'fixture-5': 'data:image/png;base64,invalid' };
        r.next();
      });
      await page.waitForFunction(() => !!document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehReader').error);
      assert.deepEqual((await visible()).map(p => p.index), [4, 3], 'decode failure retains the last readable spread');
      await page.evaluate(() => {
        const r = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehReader');
        r.imageCache = { ...r.imageCache, 'fixture-5': window.fixtureImage(5) };
      });
      await page.waitForFunction(() => document.querySelector('.reader-frame:not(.preparing) img')?.src.includes('PAGE%206'));
      assert.deepEqual((await visible()).map(p => p.index), [6, 5]);
      assert.equal(await page.evaluate(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehReader').error), '');
      const samples = await page.evaluate(() => { window.sampling = false; return window.framesSeen; });
      assert(samples.length > 5);
      assert(samples.every(frame => frame.length > 0 && frame.every(image => image.ready)), 'every sampled frame retains complete image content');
      assert(samples.every(frame => !frame.some(image => image.width === 1600) || (frame.length === 1 && frame[0].landscape)), 'no incorrectly paired landscape frame');
      const output = process.env.READER_QA_OUTPUT || path.join(require('node:os').tmpdir(), 'ark-reader-qa');
      fs.mkdirSync(output, { recursive: true });
      await page.screenshot({ path: `${output}/reader-buffer-${native ? 'native' : size.join('x')}.png` });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), 'reader must not overflow the window');
      await page.evaluate(() => {
        const r = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehReader');
        r.direction = 'ltr';
      });
      await page.waitForFunction(() => document.querySelector('.reader-frame:not(.preparing) img')?.src.includes('PAGE%205'));
      assert.deepEqual((await visible()).map(p => p.index), [5, 6]);
      await page.evaluate(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehReader').setPageMode('single'));
      await page.waitForFunction(() => document.querySelectorAll('.reader-frame:not(.preparing) img').length === 1);
      assert.deepEqual((await visible()).map(p => p.index), [5]);
      await page.evaluate(() => { document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehReader').zoom = 150; });
      await page.mouse.move(600, 350);
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(100);
      assert(await page.locator('.reader-canvas').evaluate(canvas => canvas.scrollTop > 0), 'zoomed wheel still scrolls within the page');
      assert.deepEqual((await visible()).map(p => p.index), [5]);
      await page.evaluate(() => {
        document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').showPage('page-home');
      });
      await page.waitForFunction(() => document.querySelectorAll('.reader-frame').length === 0);
      console.log(`PASS ${native ? 'native' : size.join('x')}: ${samples.length} frames, no empty/unloaded/incorrect landscape frame; delayed load/decode, wheel, rapid turns and failure recovery`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
