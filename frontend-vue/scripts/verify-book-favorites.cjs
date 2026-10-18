const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const output = path.join(require('node:os').tmpdir(), 'ark-book-favorites-qa');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    for (const [width, height] of [[1920, 1080], [1366, 768], [1280, 720]]) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(theme => localStorage.setItem('media-library-theme', theme), theme);
      await page.goto(process.env.HAND_QA_URL || 'http://127.0.0.1:1422');
      await page.waitForFunction(() => document.getElementById('app')?.__vue_app__?.config.globalProperties.$pinia._s.get('ehLibrary')?.galleries.length);
      const id = await page.evaluate(async () => {
        const { ehApi } = await import('/src/api/commands/eh.ts');
        const store = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehLibrary');
        const id = store.galleries[0].gid;
        await ehApi.downloadHitomi({ id, pageIndices: [1] });
        await store.load();
        return id;
      });
      await page.getByRole('button', { name: '本子', exact: true }).click();
      assert(await page.getByTitle('尚未收藏作品', { exact: true }).isDisabled());
      for (const source of ['eh', 'hitomi']) {
        await page.evaluate(source => {
          const store = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehLibrary');
          store.showDetail(store.galleries.find(gallery => gallery.source === source));
        }, source);
        const rows = page.locator('#detailTags .detail-tag-row');
        const labels = await rows.locator('.detail-section-title').allTextContents();
        assert.equal(labels[0], '作品号');
        for (const removed of ['来源', '语言', '分类']) assert(!labels.includes(removed));
        const name = `${source === 'eh' ? 'Ehentai' : 'Hitomi'} · ${id}`;
        const number = page.locator('#detailTags .detail-tag-row').filter({ hasText: '作品号' }).locator('button');
        assert.equal((await number.textContent()).trim(), name);
        assert.equal(await number.getAttribute('aria-pressed'), 'false');
        await number.click();
        await page.waitForFunction(gid => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehLibrary').isFavorite(gid), source === 'eh' ? id : -id);
        assert.equal(await number.getAttribute('aria-pressed'), 'true');
        assert.equal(await number.locator('.favorite-character-star').count(), 1);
        const rect = await number.boundingBox();
        assert(rect.x >= 0 && rect.x + rect.width <= width);
        await page.screenshot({ path: path.join(output, `${width}-${theme}-${source}.png`) });
        await page.getByRole('button', { name: '返回', exact: true }).click();
      }
      await page.getByTitle('只看收藏作品', { exact: true }).click();
      assert.equal(await page.evaluate(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehLibrary').filteredGalleries.length), 2);
      await page.locator('#searchInput').fill('Hitomi');
      assert.equal(await page.evaluate(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehLibrary').filteredGalleries[0].gid), -id);
      await page.locator('#searchClear').click();
      assert.equal(await page.evaluate(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehLibrary').favoriteMode), false);
      // 收藏重载来自同一 typed API，不靠详情组件或临时页面状态保持。
      await page.evaluate(async () => {
        const store = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehLibrary');
        store.favoriteGids = []; await store.load();
      });
      assert.equal(await page.evaluate(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehLibrary').favoriteGids.length), 2);
      for (const gid of [id, -id]) {
        await page.evaluate(gid => {
          const store = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehLibrary');
          store.showDetail(store.galleries.find(gallery => gallery.gid === gid));
        }, gid);
        await page.getByTitle('取消收藏作品', { exact: true }).click();
        await page.waitForFunction(gid => !document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehLibrary').isFavorite(gid), gid);
        await page.getByRole('button', { name: '返回', exact: true }).click();
      }
      assert(await page.getByTitle('尚未收藏作品', { exact: true }).isDisabled());
      await page.getByRole('button', { name: '里番', exact: true }).click();
      assert(await page.getByTitle('只看收藏角色作品', { exact: true }).isVisible());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      console.log(`PASS ${width}x${height} ${theme}: one identity row, independent same-number sources, star toggle, filtering, reload and media favorite unchanged`);
      await page.close();
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
