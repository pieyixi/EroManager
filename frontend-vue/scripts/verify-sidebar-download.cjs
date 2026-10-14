const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = createRequire(path.join(__dirname, '../package.json'))('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const output = path.join(require('node:os').tmpdir(), 'ark-sidebar-download-qa');
  fs.mkdirSync(output, { recursive: true });
  try {
    await page.goto(process.env.HAND_QA_URL || 'http://127.0.0.1:1422');
    await page.waitForSelector('.sidebar-secondary');
    await page.waitForFunction(() => {
      const stores = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
      return stores.get('library').works.length && stores.get('ehLibrary').galleries.length;
    });
    for (const [width, height] of [[1920, 1080], [1366, 768], [1280, 720]]) {
      await page.setViewportSize({ width, height });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => {
          document.documentElement.dataset.theme = theme;
          document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ui').theme = theme;
        }, theme);
        const sidebar = page.locator('.sidebar-secondary');
        const labels = await sidebar.locator('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
        assert.equal(labels.at(-2), '下载');
        assert.equal(labels.at(-1), '设置');
        await page.getByRole('button', { name: '下载', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').activePage === 'page-eh-download');
        assert(await page.getByRole('button', { name: '下载', exact: true }).evaluate(button => button.classList.contains('active')));
        assert.equal(await page.getByRole('button', { name: '设置', exact: true }).evaluate(button => button.classList.contains('active')), false);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
        await page.getByRole('button', { name: '首页', exact: true }).click();
        await page.mouse.move(width / 2, 80);
        await page.waitForTimeout(300);
        await sidebar.screenshot({ path: path.join(output, `${width}-${theme}.png`) });
        console.log(`PASS ${width}x${height} ${theme}: sidebar order, download navigation, active state, bounds`);
      }
    }
    for (const [label, origin] of [['首页', 'page-home'], ['里番', 'page-media-library'], ['本子', 'page-eh-library'], ['设置', 'page-settings'], ['未建档', 'page-unarchived']]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForFunction(origin => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').activePage === origin, origin);
      await page.getByRole('button', { name: '下载', exact: true }).click();
      await page.getByRole('button', { name: '下载', exact: true }).click();
      await page.getByRole('button', { name: '返回', exact: true }).click();
      assert.equal(await page.evaluate(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').activePage), origin);
      console.log(`PASS sidebar downloads return to ${origin}, including repeated clicks`);
    }
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '作品下载', exact: true }).click();
    await page.getByRole('button', { name: '返回', exact: true }).click();
    assert.equal(await page.evaluate(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').activePage), 'page-settings');
    console.log('PASS Settings download trigger retains Settings return');
    await page.evaluate(async () => {
      const stores = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
      const library = stores.get('library');
      await library.showDetail(library.works[0].id, 'page-home');
    });
    const detailBefore = await page.evaluate(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('library').currentDetailWorkId);
    await page.getByRole('button', { name: '下载', exact: true }).click();
    await page.getByRole('button', { name: '返回', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => {
      const stores = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
      return { page: stores.get('navigation').activePage, back: stores.get('navigation').backPage, id: stores.get('library').currentDetailWorkId };
    }), { page: 'page-detail', back: 'page-home', id: detailBefore });
    await page.getByRole('button', { name: '返回', exact: true }).click();
    assert.equal(await page.evaluate(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').activePage), 'page-home');
    console.log('PASS detail → downloads → same detail → original home');
    const bookId = await page.evaluate(() => {
      const stores = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
      const books = stores.get('ehLibrary');
      books.showDetail(books.galleries[0], 'page-home');
      return books.currentGallery.gid;
    });
    await page.getByRole('button', { name: '下载', exact: true }).click();
    await page.getByRole('button', { name: '返回', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => {
      const stores = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
      return { page: stores.get('navigation').activePage, back: stores.get('navigation').backPage, id: stores.get('ehLibrary').currentGallery.gid };
    }), { page: 'page-detail', back: 'page-home', id: bookId });
    console.log('PASS book detail survives download round trip without changing its work or return chain');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
