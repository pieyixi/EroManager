const{chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch();let cases=0;try{
for(const theme of ['light','dark'])for(const[count,initial]of [[2,0],[3,0],[3,2],[9,8]]){
 const page=await browser.newPage({viewport:{width:1280,height:720}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.HAND_QA_URL||'http://127.0.0.1:1422');await page.waitForFunction(()=>{const s=document.getElementById('app')?.__vue_app__?.config.globalProperties.$pinia._s;return s?.get('library')?.works.length>=9&&s.get('home')?.media.current});
 await page.evaluate(({count,initial,theme})=>{document.documentElement.dataset.theme=theme;const s=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;const hand=s.get('homeHand');s.get('library').works.slice(0,count).forEach(w=>hand.add('media',{id:w.id,title:w.title,cover:s.get('home').media.current.cover,previews:[]}));hand.select(initial)},{count,initial,theme});
 await page.locator('.home-hand-card.is-main').click();await page.waitForFunction(()=>!document.querySelector('.home-hand').classList.contains('is-layout-changing'));
 await page.locator('.home-hand').dispatchEvent('wheel',{deltaY:120});
 await page.waitForFunction(()=>{const root=document.querySelector('.home-hand');const slot=Math.abs(Number(root.querySelector('.home-hand-card.is-main')?.dataset.slot));return root.classList.contains('is-moving')&&slot<.009&&slot>.001},null,{polling:'raf'});
 const key=await page.locator('.home-hand-card.is-main').getAttribute('data-card-key');
 // locator.click() waits for stability and would silently miss this race; use actual mouse events.
 let rect=await page.locator('.home-hand-card.is-main').boundingBox();await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
 await page.waitForFunction(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').activePage==='page-detail');await page.locator('.home-detail-flight').waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('homeHand').current.key),key);
 await page.getByRole('button',{name:'返回',exact:true}).click();await page.locator('#page-home.active').waitFor();await page.locator('.home-detail-flight').waitFor({state:'detached'});
 assert.equal(await page.locator('.home-hand-card.is-main').getAttribute('data-slot'),'0');
 rect=await page.locator('.home-hand-card.is-main').boundingBox();await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);await page.locator('#page-detail.active').waitFor();
 assert.deepEqual(errors,[]);await page.close();cases++;console.log(`PASS ${theme} ${count} cards, initial ${initial}: interrupted near-end click opens current card and remains clickable after return`);
}
console.log(`PASS ${cases} raw-mouse end-interruption regressions`);
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
