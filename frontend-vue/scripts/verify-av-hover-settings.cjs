const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const output = path.join(os.tmpdir(), 'ero-av-hover-settings-qa'); fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[1920,1080],[1366,768],[1280,720]]) for (const theme of ['light','dark']) {
      const page = await browser.newPage({ viewport: { width, height } }); const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://127.0.0.1:1422'); await page.locator('.startup-screen').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => !document.querySelector('.window').inert);
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.getByRole('button', { name: 'AV', exact: true }).click(); await page.locator('.av-work-card').first().click();
      await page.locator('.home-detail-flight').waitFor({ state: 'detached' });
      const gallery = page.locator('.shared-image-gallery'); await gallery.scrollIntoViewIfNeeded();
      await gallery.locator('img').first().waitFor(); await gallery.locator('.gallery-thumbnail').first().click(); await page.waitForTimeout(600);
      const base = await boxes(); const first = gallery.locator('.gallery-thumbnail').first();
      await first.hover(); await page.waitForTimeout(80); const mid = await first.boundingBox();
      assert(mid.width > base[0].width + 1 && mid.width < base[0].width*2.1, 'intermediate expansion must be animated');
      await page.waitForTimeout(600); const expanded = await boxes();
      assert(expanded[0].width > base[0].width*1.9);
      assert(expanded.slice(1).some((box,i) => Math.abs(box.x-base[i+1].x)>5 || Math.abs(box.y-base[i+1].y)>5), 'neighbor images move aside');
      for (let a=0;a<expanded.length;a++) for (let b=a+1;b<expanded.length;b++) {
        const x=expanded[a], y=expanded[b]; assert(Math.min(x.right,y.right)-Math.max(x.x,y.x)<1 || Math.min(x.bottom,y.bottom)-Math.max(x.y,y.y)<1, 'settled previews must not overlap');
      }
      const stationary = await first.getAttribute('aria-expanded'); await page.waitForTimeout(600);
      assert.equal(stationary,'true'); assert.equal(await first.getAttribute('aria-expanded'),'true');
      await page.screenshot({ path: path.join(output,`${width}-${theme}-hover.png`) });
      await first.click(); assert.equal(await page.getByRole('dialog',{name:'预览图',exact:true}).count(),0);
      await page.mouse.move(30,90); await page.waitForTimeout(600);
      const restored = await boxes(); assert(Math.abs(restored[0].width-base[0].width)<1);
      for (let i=0;i<3;i++) {
        const target=gallery.locator('.gallery-thumbnail').nth(i); await target.hover(); await page.waitForTimeout(50);
      }
      await page.waitForTimeout(600); assert.equal(await gallery.locator('.expanded').count(),1);
      await page.mouse.move(30,90); await page.waitForTimeout(600);
      const keyboard=gallery.locator('.gallery-thumbnail').nth(1); await keyboard.focus(); await page.waitForTimeout(600);
      assert.equal(await keyboard.getAttribute('aria-expanded'),'true'); await keyboard.press('Escape');
      assert.equal(await keyboard.getAttribute('aria-expanded'),'false');
      await page.locator('.app-sidebar').getByRole('button',{name:'下载',exact:true}).click(); await page.getByRole('tab',{name:'JavDB 获取',exact:true}).click();
      const lane=page.locator('#download-panel-javdb'); await page.waitForFunction(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('avDownload').initialized);
      assert.equal(await lane.locator('input').count(),1); assert.equal(await lane.getByRole('textbox',{name:'AV 资料目录',exact:true}).count(),0);
      await page.evaluate(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('avDownload').root='');
      await lane.getByRole('textbox',{name:'番号',exact:true}).fill('TEST-990'); await lane.getByRole('button',{name:'加入队列',exact:true}).click();
      assert.match(await lane.locator('.av-fetch-error').textContent(),/设置.*数据/);
      await page.getByRole('button',{name:'设置',exact:true}).click();
      const settings=page.locator('#page-settings'); await settings.getByRole('button',{name:'数据',exact:true}).click();
      const section=settings.getByRole('region',{name:'AV 数据',exact:true}); await section.scrollIntoViewIfNeeded();
      const field=section.getByRole('textbox',{name:'AV 资料目录',exact:true}); await field.fill('D:\\MockAvLibrary-HoverQA'); await field.press('Enter');
      await page.waitForFunction(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('avDownload').root==='D:\\MockAvLibrary-HoverQA');
      const widths=await settings.locator('.settings-data-group').evaluateAll(groups=>groups.map(group=>group.querySelector('.settings-path-control').getBoundingClientRect().width));
      assert.equal(widths.length,3); assert(widths.every(w=>Math.abs(w-560)<1));
      const buttons=await settings.locator('.settings-data-group>.settings-path-control>.btn-secondary').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().width));
      assert(buttons.every(w=>Math.abs(w-134)<1));
      await page.screenshot({path:path.join(output,`${width}-${theme}-settings.png`)});
      await page.locator('.app-sidebar').getByRole('button',{name:'下载',exact:true}).click(); assert.equal(await lane.locator('.av-fetch-error').count(),0);
      await lane.getByRole('button',{name:'加入队列',exact:true}).click();
      await page.waitForFunction(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('avDownload').jobs.some(job=>job.code==='TEST-990'&&job.status==='complete'));
      await page.getByRole('button',{name:'设置',exact:true}).click(); await section.scrollIntoViewIfNeeded(); assert.equal(await field.inputValue(),'D:\\MockAvLibrary-HoverQA');
      assert.deepEqual(errors,[]); console.log(`PASS ${width} ${theme}: hover push/restore/stability, no modal, directory in shared Data layout and fetch uses saved root`);
      await page.close();
      async function boxes(){return gallery.locator('.gallery-thumbnail').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().toJSON()));}
    }
    console.log(`Evidence: ${output}`);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
