const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const output = path.join(os.tmpdir(), 'ero-av-photo-stack-qa'); fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[1920,1080],[1366,768],[1280,720]]) for (const theme of ['light','dark']) {
      const context = await browser.newContext({ viewport: { width,height }, permissions:['clipboard-read','clipboard-write'] });
      const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://127.0.0.1:1422'); await page.locator('.startup-screen').waitFor({state:'hidden'});
      await page.waitForFunction(() => !document.querySelector('.window').inert);
      await page.evaluate(theme => { document.documentElement.dataset.theme=theme; },theme);
      await page.getByRole('button',{name:'AV',exact:true}).click(); await page.locator('.av-work-card').first().click();
      await page.locator('.home-detail-flight').waitFor({state:'detached'});
      const labels = await page.locator('.av-detail-main .detail-section-title').allTextContents();
      assert(labels.indexOf('时长') < labels.indexOf('发行日期'));
      const gallery = page.locator('.shared-image-gallery'), photos = gallery.locator('.gallery-thumbnail'), first=photos.first();
      assert.match(await gallery.getAttribute('class'),/folded/); await gallery.scrollIntoViewIfNeeded(); await first.locator('img').waitFor();
      await gallery.scrollIntoViewIfNeeded(); await page.waitForTimeout(550);
      const before = await photos.nth(1).evaluate(node=>getComputedStyle(node).transform);
      await first.hover(); await page.waitForTimeout(580);
      assert.notEqual(await photos.nth(1).evaluate(node=>getComputedStyle(node).transform),before, 'hover fans lower photos');
      await page.screenshot({path:path.join(output,`${width}-${theme}-stack.png`)});
      const foldedHeight=(await gallery.boundingBox()).height;
      const matrix = node => getComputedStyle(node).transform;
      const foldedMatrix=await photos.nth(1).evaluate(matrix);
      await first.click(); await page.waitForTimeout(90);
      const duringHeight=(await gallery.boundingBox()).height;
      const duringMatrix=await photos.nth(1).evaluate(matrix);
      await page.waitForTimeout(650);
      const openHeight=(await gallery.boundingBox()).height;
      assert(duringHeight>foldedHeight && duringHeight<openHeight, 'stack unfolds continuously');
      const finalMatrix=await photos.nth(1).evaluate(matrix);
      assert.notEqual(duringMatrix,foldedMatrix); assert.notEqual(duringMatrix,finalMatrix, 'photos themselves move through intermediate transforms');
      assert(!/folded/.test(await gallery.getAttribute('class')));
      assert(await photos.nth(6).locator('img').count());
      await page.mouse.move(80,90); await page.waitForTimeout(550);
      const boxes=await photos.evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().toJSON()));
      for(let a=0;a<boxes.length;a++) for(let b=a+1;b<boxes.length;b++) { const x=boxes[a],y=boxes[b]; assert(Math.min(x.right,y.right)-Math.max(x.x,y.x)<1 || Math.min(x.bottom,y.bottom)-Math.max(x.y,y.y)<1); }
      const edge=await first.evaluate(node=>getComputedStyle(node).borderTopColor);
      await first.hover(); await page.waitForTimeout(600); assert(await first.evaluate(node=>node.classList.contains('expanded')));
      assert.deepEqual(await first.evaluate(node=>({cursor:getComputedStyle(node).cursor,edge:getComputedStyle(node).borderTopColor})),{cursor:'default',edge}, 'hover retains the normal border and cursor');
      await page.locator('.av-preview-panel .episodes-title').click(); await page.waitForTimeout(90);
      assert.match(await gallery.getAttribute('class'),/folded/);
      const returnHeight=(await gallery.boundingBox()).height; assert(returnHeight>foldedHeight+1, 'collapse animates back instead of replacing nodes');
      await page.waitForTimeout(650); assert(Math.abs((await gallery.boundingBox()).height-foldedHeight)<1);
      await first.click(); await page.waitForTimeout(80); await page.locator('.av-preview-panel .episodes-title').click();
      await page.waitForTimeout(80); await first.click(); await page.waitForTimeout(650);
      assert(!/folded/.test(await gallery.getAttribute('class')), 'fast reverse reaches expanded state');
      await page.keyboard.press('Escape'); await page.waitForTimeout(600);
      // 模拟展开时滚动条造成的宽度重测，不能撤掉 ready 直接跳到目标位置。
      await first.click(); await page.waitForTimeout(70);
      await gallery.evaluate(node=>{node.style.width='calc(100% - 14px)';}); await page.waitForTimeout(60);
      assert.match(await gallery.getAttribute('class'),/ready/);
      assert(await photos.nth(1).evaluate(node=>node.getAnimations().some(animation=>animation.playState==='running')));
      await page.waitForTimeout(650); await gallery.evaluate(node=>{node.style.width='';}); await page.waitForTimeout(600);
      await page.keyboard.press('Escape'); await page.waitForTimeout(600);
      const trigger=page.getByRole('button',{name:'磁力链接',exact:true}), symbol=trigger.locator('svg');
      await trigger.hover(); await page.waitForTimeout(150); const sway=await symbol.evaluate(matrix);
      await page.waitForTimeout(150); assert.notEqual(await symbol.evaluate(matrix),sway,'magnet sways gently on hover');
      await trigger.click(); await page.waitForTimeout(80);
      const angle=await symbol.evaluate(node=>{const m=new DOMMatrixReadOnly(getComputedStyle(node).transform);return Math.atan2(m.b,m.a)*180/Math.PI;});
      assert(angle<-.2 && angle>-28,'click settles from the live hover pose through intermediate angles');
      await page.waitForTimeout(450);
      assert(await symbol.evaluate(node=>Math.abs(new DOMMatrixReadOnly(getComputedStyle(node).transform).b)<.001));
      const bubble=page.locator('.av-magnet-bubble'); await bubble.waitFor();
      const values=['magnet:?xt=urn:btih:0123456789012345678901234567890123456789','magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'];
      for(const [i,value] of values.entries()) {
        await bubble.getByRole('textbox',{name:'添加磁力链接',exact:true}).fill(value); await bubble.getByRole('button',{name:'添加',exact:true}).click();
        await page.waitForFunction(count=>document.querySelectorAll('.av-magnet-row').length===count,i+1);
      }
      assert.equal(await bubble.locator('.av-magnet-row').count(),2);
      await bubble.getByRole('button',{name:'复制磁力链接 1',exact:true}).click();
      assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),values[0]);
      await bubble.getByRole('button',{name:'删除磁力链接 1',exact:true}).click();
      await page.waitForFunction(()=>document.querySelectorAll('.av-magnet-row').length===1);
      assert.equal(await bubble.locator('.av-magnet-row').count(),1);
      assert.equal(await bubble.getByRole('textbox',{name:'已保存的磁力链接',exact:true}).inputValue(),values[1]);
      await page.screenshot({path:path.join(output,`${width}-${theme}-bubble.png`)});
      const bounds=await bubble.boundingBox(); assert(bounds.x>=64 && bounds.x+bounds.width<=width && bounds.y>=0);
      await page.locator('.av-preview-panel .episodes-title').click(); await bubble.waitFor({state:'detached'});
      await trigger.click(); assert.equal(await bubble.locator('.av-magnet-row').count(),1);
      await page.getByRole('button',{name:'返回',exact:true}).click(); await page.locator('.home-detail-flight').waitFor({state:'detached'});
      assert.equal(await page.locator('.av-magnet-dock').count(),0);
      assert.deepEqual(errors,[]); console.log(`PASS ${width} ${theme}: row order, photo fan/unfold/return/reverse, bubble add/copy/delete and route cleanup`);
      await context.close();
    }
    console.log(`Evidence: ${output}`);
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
