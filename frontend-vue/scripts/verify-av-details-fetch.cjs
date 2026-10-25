const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const output = path.join(os.tmpdir(), 'ero-av-details-fetch-qa'); fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[1920, 1080], [1366, 768], [1280, 720]]) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height } }); const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://127.0.0.1:1422'); await page.locator('.startup-screen').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => !document.querySelector('.window').inert);
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.getByRole('button', { name: 'AV', exact: true }).click();
      const first = page.locator('.av-work-card').first(); await first.waitFor(); const code = await first.getAttribute('data-code');
      await first.click(); await flight('av-grid:', 'enter');
      const detail = page.locator('#page-detail'); assert(await detail.isVisible());
      assert.match(await detail.locator('.av-detail-main .detail-title').textContent(), /[ぁ-ヿ]/);
      assert.equal(await detail.locator('.eh-read-entry').count(), 0); assert.deepEqual(await detail.locator('.av-video-panel .episode-num').allTextContents(), ['原版','剪辑版']);
      assert.equal(await detail.locator('.favorite-character-star').count(), 0);
      assert.equal(await detail.locator('.gallery-thumbnail').count(), 8);
      const preview = detail.locator('.gallery-thumbnail').first();
      await preview.click(); await page.waitForTimeout(600); await preview.hover(); await page.waitForTimeout(600);
      assert.equal(await preview.getAttribute('aria-expanded'), 'true');
      await preview.click(); assert.equal(await page.getByRole('dialog', { name: '预览图', exact: true }).count(), 0);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '磁力链接', exact: true }).click();
      await page.locator('.av-magnet-bubble').getByRole('textbox', { name: '添加磁力链接', exact: true }).fill('magnet:?xt=urn:btih:0123456789012345678901234567890123456789');
      await page.locator('.av-magnet-bubble').getByRole('button', { name: '添加', exact: true }).click();
      await page.locator('.av-magnet-bubble').getByRole('textbox', { name: '已保存的磁力链接', exact: true }).waitFor();
      assert(await detail.locator('#detailCover img').isVisible());
      await page.screenshot({ path: path.join(output, `${width}-${theme}-detail.png`) });
      await page.getByRole('button', { name: '返回', exact: true }).click(); await flight('av-grid:', 'return');
      await page.locator('#page-av-library').waitFor({state:'visible'}); assert.equal(await page.locator('.av-work-card').first().getAttribute('data-code'), code);
      assert.equal(await detail.locator('.gallery-thumbnail img').count(), 0, 'detail preview resources released after leaving');
      assert(await page.evaluate(() => !Object.keys(document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('avLibrary').coverCache).some(path => path.includes('av-preview'))), 'previews must stay out of the library cover cache');
      await page.getByRole('button', { name: '下载', exact: true }).click();
      await page.getByRole('tab', { name: 'JavDB 获取', exact: true }).click();
      const lane = page.locator('#download-panel-javdb'); await page.waitForFunction(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('avDownload').initialized);
      const input = lane.getByRole('textbox', { name: '番号', exact: true }); await input.fill('test900'); await input.press('Enter');
      await input.fill('TEST-901'); await input.press('Enter');
      await page.waitForFunction(() => {
        const jobs = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('avDownload').jobs;
        return jobs.length === 2 && jobs.every(job => job.status === 'complete');
      });
      assert.equal(await lane.locator('.eh-download-card').count(), 2);
      await lane.getByRole('button', { name: '查看 TEST-900 的作品详情' }).click(); await flight('av-download:', 'enter');
      assert.match(await detail.locator('.detail-title').textContent(), /TEST-900/);
      assert.equal(await detail.locator('.gallery-thumbnail').count(), 8);
      await page.getByRole('button', { name: '返回', exact: true }).click(); await flight('av-download:', 'return');
      assert(await lane.isVisible()); assert(await lane.getByRole('textbox', { name: '番号', exact: true }).isVisible());
      await input.fill('MISSING-404'); await input.press('Enter');
      const failed = lane.locator('[data-code="MISSING-404"]'); await failed.getByRole('button', { name: '重试获取' }).waitFor();
      assert.match(await failed.textContent(), /没有找到完全匹配/);
      await page.getByRole('tab', { name: 'Eh 下载', exact: true }).click(); assert(await page.locator('#download-panel-eh').isVisible());
      await page.getByRole('tab', { name: 'Hitomi 下载', exact: true }).click(); assert(await page.locator('#download-panel-hitomi').isVisible());
      await page.getByRole('tab', { name: 'JavDB 获取', exact: true }).click();
      assert.equal(await lane.locator('.eh-download-card').count(), 3);
      await page.screenshot({ path: path.join(output, `${width}-${theme}-fetch.png`) });
      await page.getByRole('button', { name: '返回', exact: true }).click(); assert(await page.locator('#page-home').isVisible());
      await page.getByRole('button', { name: 'AV', exact: true }).click(); await page.locator('#searchInput').fill('TEST-900');
      assert.equal(await page.locator('.av-work-card').count(), 1);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width} ${theme}: shared detail/cover return, jacket clipping, Japanese, preview gallery, magnets, FIFO fetch and failure`);
      await page.close();
      async function flight(origin, direction) {
        const el = page.locator(`.home-detail-flight[data-origin^="${origin}"][data-direction="${direction}"]`);
        await el.waitFor({ state: 'visible' });
        const data = await el.evaluate(node => {
          const animations = node.getAnimations({ subtree: true });
          const image = node.querySelector('img'); const frame = image.getAnimations()[0].effect.getKeyframes()[0];
          return { count: animations.length, clip: frame.clipPath };
        });
        assert(data.count >= 2); assert(data.clip.startsWith('inset('));
        assert(Number.parseFloat(data.clip.split(/\s+/)[3]) > 1, 'right jacket half remains clipped throughout flight');
        await el.waitFor({ state: 'detached' });
      }
    }
    console.log(`Evidence: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
