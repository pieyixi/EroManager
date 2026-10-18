const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = createRequire(path.join(__dirname, '../package.json'))('playwright');

const phase = process.argv.includes('--after') ? 'after' : 'before';
const output = path.join(require('node:os').tmpdir(), 'ark-frontend-structure-qa');
fs.mkdirSync(path.join(output, phase), { recursive: true });
function flattenedStyles(file) {
  return fs.readFileSync(file, 'utf8').replace(/@import\s+['"]([^'"]+)['"];?/g,
    (_, relative) => flattenedStyles(path.resolve(path.dirname(file), relative)));
}
const css = flattenedStyles(path.join(__dirname, '../src/assets/styles.css')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
if (phase === 'before') fs.writeFileSync(path.join(output, 'cascade.txt'), css);
else assert.equal(css, fs.readFileSync(path.join(output, 'cascade.txt'), 'utf8'), 'global CSS selectors, values and cascade must be unchanged');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    for (const [width, height] of [[1920, 1080], [1366, 768], [1280, 720]]) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(theme => {
        localStorage.setItem('media-library-theme', theme);
        let seed = 123456;
        Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      }, theme);
      await page.goto(process.env.HAND_QA_URL || 'http://127.0.0.1:1422');
      await page.waitForFunction(() => {
        const s = document.getElementById('app')?.__vue_app__?.config.globalProperties.$pinia._s;
        return s?.get('library')?.works.length && s.get('ehLibrary').galleries.length &&
          s.get('home').media.phase === 'idle' && s.get('home').book.phase === 'idle';
      });
      // 固定展示样本而非全局随机序列：Vue 组件数量变化不应改变视觉基线选中的作品。
      await page.evaluate(() => {
        const s = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
        const home = s.get('home');
        const image = (width, height, color) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`)}`;
        home.media.current = { id: s.get('library').works[0].id, title: 'Sample media', cover: image(300, 400, '#b8cde1'),
          previews: [1, 2, 3].map(i => ({ key: String(i), label: `Episode ${i}`, image: image(640, 360, '#c5d9d0') })) };
        home.book.current = { id: s.get('ehLibrary').galleries[0].gid, title: 'Sample book', cover: image(300, 400, '#d8bdd2'),
          previews: [1, 2, 3].map(i => ({ key: String(i), label: `Page ${i}`, image: image(i === 2 ? 600 : 300, 400, '#dfd4be') })) };
      });
      for (const scenario of ['home', 'media-library', 'eh-library', 'settings', 'eh-download', 'unarchived', 'archive', 'detail-media', 'detail-book', 'eh-reader', 'player']) {
        await page.evaluate(async scenario => {
          const s = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
          const nav = s.get('navigation'), media = s.get('library'), books = s.get('ehLibrary');
          if (scenario === 'detail-media') await media.showDetail(media.works[0].id);
          else if (scenario === 'detail-book') books.showDetail(books.galleries[0]);
          else if (scenario === 'eh-reader') await s.get('ehReader').open(books.galleries[0]);
          else if (scenario === 'unarchived') await s.get('archive').openUnarchivedPage();
          else if (scenario === 'archive') await s.get('archive').openArchiveAssistant(s.get('archive').folders[0]?.dir_path || 'mock://unarchived/1');
          else nav.showPage(`page-${scenario}`);
        }, scenario);
        await page.waitForTimeout(500);
        await page.mouse.move(width - 4, height - 4);
        const key = `${width}-${theme}-${scenario}`;
        const snapshot = await page.evaluate(() => {
          const root = document.querySelector('.window');
          const visible = [...root.querySelectorAll('*')].filter(el => {
            const r = el.getBoundingClientRect(), css = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && css.visibility === 'visible' && css.display !== 'none';
          });
          return { overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
            nodes: visible.map(el => { const r = el.getBoundingClientRect(); return {
              tag: el.tagName, id: el.id, class: typeof el.className === 'string' ? el.className : '',
              label: el.getAttribute('aria-label'), placeholder: el.getAttribute('placeholder'),
              text: el.childElementCount ? '' : el.textContent.trim(),
              rect: [r.x, r.y, r.width, r.height].map(n => Math.round(n * 100) / 100),
            }; }) };
        });
        assert.equal(snapshot.overflow, false, `${key}: document overflow`);
        const baselineFile = path.join(output, 'before', `${key}.json`);
        if (phase === 'after') assert.deepEqual(snapshot, JSON.parse(fs.readFileSync(baselineFile, 'utf8')), `${key}: visible DOM, labels or geometry changed`);
        fs.writeFileSync(path.join(output, phase, `${key}.json`), JSON.stringify(snapshot));
        await page.screenshot({ path: path.join(output, phase, `${key}.png`) });
      }
      // 实际点击保护：搜索展开、Esc/外点收起、两库筛选，以及下载返回链。
      await page.getByRole('button', { name: '首页', exact: true }).count().then(async count => {
        if (!count) await page.evaluate(() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').showPage('page-home'));
      });
      await page.getByRole('button', { name: '里番', exact: true }).click();
      await page.locator('#searchInput').focus();
      await page.locator('#searchInput').fill('档案');
      assert(await page.locator('.app-titlebar.search-active').count());
      await page.locator('#searchInput').press('Escape');
      await page.waitForTimeout(300);
      assert.equal(await page.locator('.app-titlebar.search-active').count(), 0);
      await page.getByRole('button', { name: /^年份/ }).click();
      assert(await page.locator('#filterDropdown').isVisible());
      await page.mouse.click(width - 50, height - 50);
      assert.equal(await page.locator('#filterDropdown').count(), 0);
      await page.getByRole('button', { name: '下载', exact: true }).click();
      await page.getByRole('button', { name: '返回', exact: true }).click();
      assert(await page.locator('#searchInput').isVisible());
      assert.equal(await page.locator('#searchInput').inputValue(), '档案');
      await page.getByRole('button', { name: '本子', exact: true }).click();
      await page.getByRole('button', { name: /^分类/ }).click();
      assert(await page.locator('.filter-dd').isVisible());
      await page.locator('#searchInput').focus();
      assert.equal(await page.locator('.filter-dd').count(), 0);
      await page.getByRole('button', { name: '首页', exact: true }).click();
      assert.equal(await page.locator('#searchInput').count(), 0);
      await page.close();
      console.log(`PASS ${phase}: ${width}x${height} ${theme}, 11 page states, shell interaction and navigation`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
