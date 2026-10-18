const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const os=require('node:os');
const path=require('node:path');
(async()=>{
  const browser=await chromium.launch();let cases=0;
  try {
    for(const [width,height] of [[1920,1080],[1366,768],[1280,720]])for(const theme of ['light','dark'])await verify(width,height,theme);
    for(const theme of ['light','dark'])await firstFailure(theme);
    console.log(`PASS ${cases} slow statistics layouts: 4.5s first load, one request, synchronized skeletons/reveal, >3s notice, fixed geometry, fade and cached refresh/retry.`);
  }finally{await browser.close();}
  async function firstFailure(theme){
    const page=await browser.newPage({viewport:{width:1366,height:768}});
    await page.addInitScript(theme=>{
      localStorage.setItem('media-library-theme',theme);localStorage.setItem('media-library-theme-mode',theme);
      localStorage.setItem('ero-browser-preferences-v1',JSON.stringify({theme}));window.__statsFail=true;
    },theme);
    await page.route('**/src/api/webMock.ts*',async route=>{
      const response=await route.fetch();const body=(await response.text()).replace('const handler = handlers[command];',`
        if(command==='eh_get_library_dashboard'&&window.__statsFail)throw new Error('initial failure fixture');
        const handler = handlers[command];`);
      await route.fulfill({response,body});
    });
    await page.goto('http://127.0.0.1:1422/?preview=settings&statsDelay=3300');
    await page.locator('.startup-screen').waitFor({state:'detached'});
    await page.getByRole('button',{name:'查看数据',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'资料库数据'}),card=page.locator('.library-stats-card').nth(1);
    await dialog.getByRole('alert').waitFor();
    assert.equal(await card.locator('.library-stats-numbers').count(),0);
    assert.equal(await card.getByText('统计加载失败，请重试',{exact:true}).count(),1);
    assert(await card.locator('.library-stats-placeholder').evaluate(e=>[...e.querySelectorAll('.library-stats-skeleton')].every(n=>getComputedStyle(n).animationName==='none')));
    const before=await card.boundingBox();
    await page.evaluate(()=>{window.__statsFail=false;});
    await dialog.getByRole('button',{name:'刷新统计',exact:true}).click();
    await dialog.getByRole('button',{name:'刷新统计',exact:true}).waitFor();
    await page.waitForFunction(()=>!document.querySelector('.library-stats-content-enter-active,.library-stats-content-leave-active'));
    assert.equal(await card.locator('.library-stats-numbers').count(),1);
    assert.equal(await dialog.getByRole('alert').count(),0);
    assert.deepEqual(await card.boundingBox(),before);
    await page.close();cases++;
  }
  async function verify(width,height,theme){
    const page=await browser.newPage({viewport:{width,height}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(theme=>{
      localStorage.setItem('media-library-theme',theme);localStorage.setItem('media-library-theme-mode',theme);
      localStorage.setItem('ero-browser-preferences-v1',JSON.stringify({theme}));
      window.__statsCalls=0;
    },theme);
    await page.route('**/src/api/webMock.ts*',async route=>{
      const response=await route.fetch();let body=await response.text();
      body=body.replace('const handler = handlers[command];',`
        if(command==='eh_get_library_dashboard'){
          window.__statsCalls++;
          if(window.__statsFail)throw new Error('fixture unavailable');
        }
        const handler = handlers[command];`);
      await route.fulfill({response,body});
    });
    await page.goto('http://127.0.0.1:1422/?preview=settings&statsDelay=4500');
    await page.locator('.startup-screen').waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>window.__statsCalls),0,'Settings entry must not start a duplicate dashboard traversal');
    await page.getByRole('button',{name:'查看数据',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'资料库数据'}),cards=page.locator('.library-stats-card');
    await page.waitForTimeout(500);
    const before=await cards.evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}}));
    assert.equal(await cards.locator('.library-stats-placeholder').count(),2,'Both cards must show skeletons while either source is pending');
    assert.equal(await cards.locator('.library-stats-numbers').count(),0,'Ready media must wait for books; unknown data must not display zeros');
    // Track the full handoff, including its opacity animation and layout every frame.
    const handoffPending=page.evaluate(()=>new Promise(resolve=>{
      const frames=[];function step(){
        const roots=document.querySelectorAll('.library-stats-card'),root=roots[1];
        const box=root.getBoundingClientRect(),data=root.querySelector('.library-stats-body');
        const media=roots[0].querySelector('.library-stats-body');
        frames.push({height:box.height,y:box.y,opacity:data?Number(getComputedStyle(data).opacity):null,
          mediaOpacity:media?Number(getComputedStyle(media).opacity):null,
          fading:!!data?.getAnimations().some(a=>a.effect.getComputedTiming().duration===280)});
        if(data&&!data.classList.contains('library-stats-content-enter-active'))resolve(frames);
        else requestAnimationFrame(step);
      }requestAnimationFrame(step);
    }));
    await page.waitForTimeout(2700);
    assert.equal(await cards.getByText('正在统计资料库…',{exact:true}).count(),2);
    await page.screenshot({path:path.join(os.tmpdir(),`ero-stats-slow-${width}-${theme}.png`)});
    const handoff=await handoffPending;
    assert(handoff.some(f=>f.opacity!==null&&f.opacity>0&&f.opacity<1||f.fading),'Loaded data should fade in with its 280ms transition');
    assert(handoff.every(f=>f.opacity===f.mediaOpacity),'Both cards must enter in the same frame at the same opacity');
    assert(handoff.every(f=>Math.abs(f.height-before[1].height)<.1&&Math.abs(f.y-before[1].y)<.1),'Loading cannot resize or move cards');
    assert.equal(await page.evaluate(()=>window.__statsCalls),1);
    const after=await cards.evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}}));
    assert.deepEqual(after,before);
    await page.screenshot({path:path.join(os.tmpdir(),`ero-stats-slow-ready-${width}-${theme}.png`)});
    if(width===1366){
      const old=await cards.nth(1).locator('.library-stats-value').allTextContents();
      const cached=await page.evaluate(()=>{
        const stores=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
        return {media:stores.get('libraryConsole').summary,books:stores.get('ehSettings').ehDashboard};
      });
      await dialog.getByRole('button',{name:'刷新统计',exact:true}).click();
      await page.waitForTimeout(3200);
      assert.equal(await cards.locator('.library-stats-placeholder').count(),2,'Cached refresh must also show matching skeletons');
      assert.equal(await cards.locator('.library-stats-numbers').count(),0);
      assert.deepEqual(await page.evaluate(()=>{
        const stores=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
        return {media:stores.get('libraryConsole').summary,books:stores.get('ehSettings').ehDashboard};
      }),cached,'Skeleton presentation must not clear cached data');
      await dialog.getByRole('button',{name:'刷新统计',exact:true}).waitFor();
      await page.waitForFunction(()=>!document.querySelector('.library-stats-content-enter-active,.library-stats-content-leave-active'));
      assert.deepEqual(await cards.nth(1).locator('.library-stats-value').allTextContents(),old);
      await page.evaluate(()=>{window.__statsFail=true;});
      await dialog.getByRole('button',{name:'刷新统计',exact:true}).click();
      await dialog.getByRole('alert').waitFor();
      await page.waitForFunction(()=>!document.querySelector('.library-stats-content-enter-active,.library-stats-content-leave-active'));
      assert.deepEqual(await cards.nth(1).locator('.library-stats-value').allTextContents(),old);
      await page.evaluate(()=>{window.__statsFail=false;});
      await dialog.getByRole('button',{name:'刷新统计',exact:true}).click();
      await dialog.getByRole('button',{name:'刷新统计',exact:true}).waitFor();
      assert.equal(await dialog.getByRole('alert').count(),0);
    }
    await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);
    assert.deepEqual(errors,[]);await page.close();cases++;
  }
})().catch(e=>{console.error(e);process.exit(1)});
