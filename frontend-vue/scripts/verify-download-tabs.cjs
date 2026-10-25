const { createRequire } = require('node:module');
const { chromium } = createRequire(require('node:path').join(__dirname, '../package.json'))('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const output = path.join(require('node:os').tmpdir(), 'ero-download-tabs-qa');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[1920, 1080], [1366, 768], [1280, 720]]) {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width, height } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(process.env.ERO_PREVIEW_URL || 'http://127.0.0.1:1422');
        await page.locator('.startup-screen').waitFor({ state: 'hidden' });
        await page.waitForFunction(() => !document.querySelector('.window').inert);
        await page.evaluate(theme => {
          const stores = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
          stores.get('ui').theme = theme;
          document.documentElement.dataset.theme = theme;
        }, theme);
        await page.getByRole('button', { name: '下载', exact: true }).click();
        const tabs = page.getByRole('tablist', { name: '下载来源' });
        assert.deepEqual(await tabs.getByRole('tab').allTextContents(), ['Eh 下载', 'Hitomi 下载', 'JavDB 获取']);
        const tabWidths = await tabs.getByRole('tab').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
        assert(tabWidths.every(value => Math.abs(value - 128) < 1), 'tabs must have equal fixed widths');
        const eh = page.locator('#download-panel-eh');
        const hitomi = page.locator('#download-panel-hitomi');
        const javdb = page.locator('#download-panel-javdb');
        assert(await eh.isVisible()); assert(!await hitomi.isVisible());
        assert.equal(await eh.locator('.eh-download-card').count(), 8);
        const geometry = await page.evaluate(() => {
          const panel = document.querySelector('.eh-download-lanes').getBoundingClientRect();
          const content = document.querySelector('.app-main').getBoundingClientRect();
          const cards = Array.from(document.querySelectorAll('#download-panel-eh .eh-download-card')).map(el => el.getBoundingClientRect().toJSON());
          return { centered: Math.abs(panel.x + panel.width / 2 - content.x - content.width / 2), cards,
            overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert(geometry.centered < 1, 'panel must be horizontally centered');
        assert(!geometry.overflow);
        const first = geometry.cards.slice(0, 5);
        assert(first.every(card => Math.abs(card.y - first[0].y) < 1), 'five cards in first row');
        assert(first.every(card => Math.abs(card.width - 184) < 2), 'five-column layout must retain original card size');
        assert(geometry.cards[5].y > first[0].y + 10, 'sixth card starts next row');
        const gaps = first.slice(1).map((card, index) => card.x - first[index].x - first[index].width);
        assert(gaps.every(gap => Math.abs(gap - 18) < 1), 'even 18px gaps');
        await eh.locator('input').nth(0).fill('123456');
        await eh.locator('input').nth(1).fill('fixture-only-token');
        const ehTop = await eh.locator('.eh-download-lane-results').evaluate(el => { el.scrollTop = 75; return el.scrollTop; });
        assert(ehTop > 0, 'results must scroll independently');
        await tabs.getByRole('tab', { name: 'Hitomi 下载', exact: true }).click();
        assert(await hitomi.isVisible()); assert(!await eh.isVisible());
        await hitomi.locator('input').fill('654321');
        const hitomiTop = await hitomi.locator('.eh-download-lane-results').evaluate(el => { el.scrollTop = 120; return el.scrollTop; });
        await tabs.getByRole('tab', { name: 'JavDB 获取', exact: true }).click();
        assert(await javdb.isVisible()); assert(await javdb.getByRole('textbox', { name: '番号', exact: true }).isVisible());
        await tabs.getByRole('tab', { name: 'Eh 下载', exact: true }).click();
        assert.equal(await eh.locator('input').nth(0).inputValue(), '123456');
        assert.equal(await eh.locator('input').nth(1).inputValue(), 'fixture-only-token');
        assert(Math.abs(await eh.locator('.eh-download-lane-results').evaluate(el => el.scrollTop) - ehTop) < 1, 'Eh tab retains scroll');
        await page.getByRole('button', { name: '首页', exact: true }).click();
        await page.getByRole('button', { name: '下载', exact: true }).click();
        await tabs.getByRole('tab', { name: 'Hitomi 下载', exact: true }).click();
        assert.equal(await hitomi.locator('input').inputValue(), '654321');
        assert(Math.abs(await hitomi.locator('.eh-download-lane-results').evaluate(el => el.scrollTop) - hitomiTop) < 1, 'hidden tab retains its scroll across leaving page');
        await hitomi.getByRole('button', { name: '清除数据', exact: true }).click();
        assert.equal(await hitomi.locator('input').inputValue(), '');
        await tabs.getByRole('tab', { name: 'Eh 下载', exact: true }).click();
        assert.equal(await eh.locator('input').nth(1).inputValue(), 'fixture-only-token');
        await eh.getByRole('button', { name: '清除数据', exact: true }).click();
        await eh.locator('.eh-download-lane-results').evaluate(el => { el.scrollTop = 0; });
        await page.mouse.move(width - 100, 30);
        await page.screenshot({ path: path.join(output, `${width}-${theme}.png`) });
        await tabs.getByRole('tab', { name: 'Eh 下载', exact: true }).focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await tabs.getByRole('tab', { name: 'Hitomi 下载', exact: true }).getAttribute('aria-selected'), 'true');
        await page.keyboard.press('End');
        assert.equal(await tabs.getByRole('tab', { name: 'JavDB 获取', exact: true }).getAttribute('aria-selected'), 'true');
        await page.keyboard.press('Home');
        await tabs.getByRole('tab', { name: 'Hitomi 下载', exact: true }).click();
        const completed = hitomi.locator('.eh-download-cover-link').first();
        await completed.scrollIntoViewIfNeeded();
        const detailTop = await hitomi.locator('.eh-download-lane-results').evaluate(el => el.scrollTop);
        await completed.click();
        await page.locator('#page-detail.active').waitFor();
        await page.waitForTimeout(750);
        await page.getByRole('button', { name: '返回', exact: true }).click();
        await page.locator('#page-eh-download.active').waitFor();
        await page.waitForTimeout(750);
        assert(await hitomi.isVisible());
        assert(Math.abs(await hitomi.locator('.eh-download-lane-results').evaluate(el => el.scrollTop) - detailTop) < 1, 'details return to same source and position');
        await page.getByRole('button', { name: '返回', exact: true }).click();
        await page.locator('#page-home.active').waitFor();
        assert.deepEqual(errors, []);
        console.log(`PASS ${width}x${height} ${theme}: tabs, five columns, centered/equal spacing, inputs/scroll, keyboard, detail return and home`);
        await page.close();
      }
    }
    console.log('Screenshots: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
