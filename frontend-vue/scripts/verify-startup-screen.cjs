const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const url = process.env.STARTUP_QA_URL || 'http://127.0.0.1:1422/';
(async () => {
  const browser = await chromium.launch(); let cases = 0;
  try {
    for (const [width, height] of [[1920,1080],[1366,768],[1280,720]])
      for (const theme of ['light','dark']) await verify({width,height,theme});
    for (const mode of ['slow','empty','error','broken-images']) await verify({mode});
    await verify({theme:'dark',system:true});
    await verify({startupPage:'media-library'});
    await verify({startupPage:'eh-library'});
    console.log(`PASS ${cases} startup cases: prepared covers/backs, paused first flips, visible entry animation, fallback, theme, destination and close/cancel.`);
  } finally { await browser.close(); }
  async function verify({width=1366,height=768,theme='light',mode='normal',system=false,startupPage='home'}={}) {
    const page=await browser.newPage({viewport:{width,height},colorScheme:theme});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({theme,system,startupPage})=>{
      localStorage.setItem('media-library-theme',theme);
      localStorage.setItem('media-library-theme-mode',system?'system':theme);
      localStorage.setItem('ero-browser-preferences-v1',JSON.stringify({theme:system?'system':theme,startup_page:startupPage}));
      window.__startupDecodes=0;
      const decode=HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode=async function(){
        window.__startupDecodes++;
        try { await new Promise(r=>setTimeout(r,300)); return await decode.call(this); }
        finally { window.__startupDecodes--; }
      };
    },{theme,system,startupPage});
    await page.route('**/src/api/webMock.ts*',async route=>{
      const response=await route.fetch(); let body=await response.text();
      const marker='const handler = handlers[command];'; assert(body.includes(marker));
      body=body.replace(marker,`
        if(command==='get_user_preferences') await new Promise(r=>setTimeout(r,250));
        if(command==='load_cover_cache' && '${mode}'==='slow') await new Promise(r=>setTimeout(r,1800));
        if('${mode}'==='empty' && ['get_all_works_with_tags','eh_list_local_galleries'].includes(command)) return [];
        if('${mode}'==='error' && ['get_all_works_with_tags','eh_list_local_galleries'].includes(command)) throw new Error('startup fixture offline');
        if('${mode}'==='broken-images' && command==='load_cover_cache') return [];
      `+marker);
      await route.fulfill({response,body});
    });
    await page.goto(url); const splash=page.locator('.startup-screen');
    await splash.waitFor({state:'visible'});
    assert.equal(await page.locator('.sakura-stamens ellipse').count(),7);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
    assert.equal(await page.locator('.window').getAttribute('inert'),'');
    assert.equal(await splash.evaluate(e=>getComputedStyle(e).backgroundColor),theme==='dark'?'rgb(30, 32, 37)':'rgb(250, 250, 250)');
    if(mode==='normal') await page.screenshot({path:path.join(os.tmpdir(),`ero-startup-${width}-${theme}.png`)});
    if(mode==='slow') {
      await page.waitForTimeout(700); assert(await splash.isVisible());
      await splash.getByRole('button',{name:'关闭',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'点击关闭按钮以后'}); await dialog.waitFor({state:'visible'});
      await dialog.getByRole('button',{name:'取消',exact:true}).click(); assert(await splash.isVisible());
    }
    await page.waitForFunction(()=>document.querySelector('.startup-screen-leave-active'));
    const ready=await page.evaluate(()=>{
      const p=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
      const media=p.get('library'),books=p.get('ehLibrary'),home=p.get('home');
      return {phases:[home.media.phase,home.book.phase],loading:[home.media.loading,home.book.loading],
        media:media.pagedWorks.every(w=>!w.cover_path||!!media.coverUrl(w.cover_path)),
        books:books.pagedGalleries.every(g=>!g.cover_path||!!books.coverUrl(g.cover_path)),
        decodes:window.__startupDecodes,page:p.get('navigation').activePage};
    });
    assert(ready.phases.every(phase=>phase==='opening'||phase==='idle')); assert.deepEqual(ready.loading,[false,false]);
    assert.equal(ready.decodes,0,'Required decoding must finish before fading');
    if(!['error','broken-images'].includes(mode)){assert(ready.media);assert(ready.books);}
    assert.equal(ready.page,`page-${startupPage}`);
    if(startupPage==='home'&&!['empty','error'].includes(mode)) {
      const paused=await page.locator('.phase-opening .home-draw-flipper').evaluateAll(elements=>elements.map(e=>({
        state:getComputedStyle(e).animationPlayState,time:e.getAnimations()[0]?.currentTime,
      })));
      assert.equal(paused.length,2);
      assert(paused.every(a=>a.state==='paused'&&Number(a.time)<1),'Opening must remain at its first frame throughout splash fade');
    }
    const entry=await page.evaluate(()=>new Promise(resolve=>{
      function frame(){
        if(document.querySelector('.startup-screen')) {requestAnimationFrame(frame);return;}
        resolve([...document.querySelectorAll('.phase-opening .home-draw-flipper')].map(e=>({
          state:getComputedStyle(e).animationPlayState,time:e.getAnimations()[0]?.currentTime,
        })));
      }
      requestAnimationFrame(frame);
    }));
    if(startupPage==='home'&&!['empty','error'].includes(mode)) {
      assert.equal(entry.length,2);
      assert(entry.every(a=>a.state==='running'&&Number(a.time)<40),`First flip should begin at visible entry: ${JSON.stringify(entry)}`);
      await page.screenshot({path:path.join(os.tmpdir(),`ero-startup-entry-${width}-${theme}.png`)});
      await page.waitForFunction(()=>{
        const h=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('home');
        return h.media.phase==='idle'&&h.book.phase==='idle';
      });
    }
    assert.equal(await page.locator('.window').getAttribute('inert'),null);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth&&document.documentElement.scrollHeight===innerHeight));
    if(mode==='normal'&&startupPage==='home') {
      for(const [target,store] of [['page-media-library','library'],['page-eh-library','ehLibrary']]) {
        const before=await page.evaluate(store=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get(store).pageSize,store);
        await page.evaluate(target=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').showPage(target),target);
        await page.waitForTimeout(280);
        const after=await page.evaluate(store=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get(store).pageSize,store);
        assert.equal(before,after);
        assert(await page.locator(`#${target} .cover-img img`).evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0)));
      }
    }
    assert.deepEqual(errors,[]); await page.close(); cases++;
  }
})().catch(e=>{console.error(e);process.exit(1)});
