const { createRequire } = require('node:module');
const { chromium } = createRequire(require('node:path').join(__dirname, '../package.json'))('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const output = path.join(require('node:os').tmpdir(), 'ero-av-library-qa');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[1920, 1080], [1366, 768], [1280, 720]]) {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width, height } });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto(process.env.ERO_PREVIEW_URL || 'http://127.0.0.1:1422');
        await page.locator('.startup-screen').waitFor({ state: 'hidden' });
        await page.waitForFunction(() => !document.querySelector('.window').inert);
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        await page.getByRole('button', { name: '里番', exact: true }).click();
        const original = await page.locator('#page-media-library .cover-img').first().boundingBox();
        await page.getByRole('button', { name: 'AV', exact: true }).click();
        const av = page.locator('#page-av-library');
        await av.locator('.av-work-card').first().waitFor();
        const toggle = page.getByRole('button', { name: '切换番号／女优显示', exact: true });
        assert.equal((await toggle.textContent()).trim(), '番号');
        assert.equal(await page.locator('.titlebar-favorite').count(), 0);
        const labels = await page.locator('#filterRow button').allTextContents();
        assert(!labels.join('').match(/时长|收藏/));
        for (const name of ['年份', '片商', '系列', 'Tag']) assert(labels.some(label => label.includes(name)));
        await page.locator('#filterRow').getByRole('button', { name: /片商/ }).click();
        assert(await page.locator('.av-filter-dd').isVisible());
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.av-filter-dd').count(), 0);
        const geometry = await av.locator('.cover-img').first().boundingBox();
        assert(Math.abs(geometry.width - original.width) < 1 && Math.abs(geometry.height - original.height) < 1, 'reuse library frame size');
        const jacket = await av.locator('.shared-cover-image').first().evaluate(el => {
          const img = el.getBoundingClientRect(), frame = el.parentElement.getBoundingClientRect();
          return { widthRatio: img.width / (frame.width - 2), right: Math.abs(img.right - frame.right + 1) };
        });
        assert(Math.abs(jacket.widthRatio - 2) < .02 && jacket.right < 1, 'right-half original jacket viewport');
        await page.screenshot({ path: path.join(output, `${width}-${theme}-code.png`) });
        const firstCodes = await av.locator('.av-work-card').evaluateAll(nodes => nodes.map(node => node.dataset.code));
        await toggle.click();
        await av.locator('.av-actress-card').first().waitFor();
        assert.equal((await toggle.textContent()).trim(), '女优');
        const actorGeometry = await av.locator('.cover-img').first().boundingBox();
        assert(Math.abs(actorGeometry.width - geometry.width) < 1 && Math.abs(actorGeometry.height - geometry.height) < 1);
        const ids = await av.locator('.av-actress-card').evaluateAll(nodes => nodes.map(node => node.dataset.actressId));
        assert.equal(ids.length, new Set(ids).size); assert(ids.length <= 14);
        assert.match(await page.locator('#resultCount').textContent(), /14\s*人/);
        assert.match(await av.locator('.page-total').textContent(), /14 人/);
        await page.screenshot({ path: path.join(output, `${width}-${theme}-actress.png`) });
        await toggle.click();
        assert.deepEqual(await av.locator('.av-work-card').evaluateAll(nodes => nodes.map(node => node.dataset.code)), firstCodes);
        await page.locator('#filterRow').getByRole('button', { name: /片商/ }).click();
        await page.locator('.av-filter-dd .dd-tag').filter({ hasText: 'Studio A' }).click();
        await page.locator('.av-filter-dd').getByRole('button', { name: '完成', exact: true }).click();
        assert.match(await page.locator('#resultCount').textContent(), /16\s*部/);
        await toggle.click(); assert.match(await page.locator('#resultCount').textContent(), /人/);
        const search = page.locator('#searchInput'); await search.fill('桜井あおい');
        assert.match(await page.locator('#resultCount').textContent(), /1\s*人/);
        const named = av.locator('.av-actress-card'); assert.equal(await named.count(), 1);
        await search.press('Escape');
        await named.click(); assert.equal((await toggle.textContent()).trim(), '番号');
        assert((await av.locator('.av-work-card').count()) > 0);
        await page.getByRole('button', { name: '清除', exact: true }).click();
        await search.fill('NOT-A-CODE'); assert(await av.getByText('没有符合条件的结果').isVisible());
        await search.press('Escape');
        await av.getByRole('button', { name: '清除筛选', exact: true }).click();
        await search.fill('demo-100'); assert.equal(await av.locator('.av-work-card').count(), 1);
        await page.getByRole('button', { name: '本子', exact: true }).click(); assert.equal(await search.inputValue(), '');
        await page.getByRole('button', { name: '里番', exact: true }).click(); assert.equal(await search.inputValue(), '');
        await page.getByRole('button', { name: 'AV', exact: true }).click(); assert.equal(await search.inputValue(), 'demo-100');
        await page.getByRole('button', { name: '清除', exact: true }).click();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const imgs = await av.locator('img').evaluateAll(nodes => nodes.every(img => img.complete && img.naturalWidth > 0));
        assert(imgs); assert.deepEqual(errors, []);
        console.log(`PASS ${width}x${height} ${theme}: shared card geometry, mode grouping, crop, JSON filters, search, actor works, source isolation`);
        await page.close();
      }
    }
    console.log(`Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
