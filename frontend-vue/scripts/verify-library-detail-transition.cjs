const {chromium}=require('playwright');const assert=require('node:assert/strict');const path=require('node:path');const os=require('node:os');
const {visibleFlightImage}=require('./cover-flight-qa.cjs');
(async()=>{const browser=await chromium.launch();let cases=0;try{
for(const[width,height]of [[1920,1080],[1366,768],[1280,720]])for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:1422');await page.locator('.startup-screen').waitFor({state:'detached'});await page.waitForTimeout(1500);
 await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.startViewTransition=()=>{throw Error('No whole-page snapshots for covers')}} ,theme);
 for(const entry of ['page-media-library','page-eh-library','page-eh-download']){
  await page.evaluate(entry=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').showPage(entry),entry);await page.waitForTimeout(600);
  if(entry==='page-eh-download'){
   await page.evaluate(()=>{const p=document.getElementById('app').__vue_app__.config.globalProperties.$pinia;const d=p._s.get('ehDownload'),l=p._s.get('ehLibrary');for(const source of ['eh','hitomi']){const item=d.history.find(h=>h.source===source&&!h.error&&h.totalPages>0&&h.failedPages.length===0),gallery=l.galleries.find(g=>g.gid===item.gid);for(let i=0;i<16;i++){const gid=(source==='eh'?1:-1)*(910000+i);d.history.push({...item,gid,queuedAt:new Date(Date.parse(item.queuedAt)-i*60000-6000000).toISOString()});l.galleries.push({...gallery,gid})}}});
   await page.waitForTimeout(300);
  }
  for(const lane of entry==='page-eh-download'?['eh','hitomi']:['grid']){
   const selector=entry==='page-media-library'?'#page-media-library .cover-card:first-child .cover-img':entry==='page-eh-library'?'#page-eh-library .cover-card:first-child .cover-img':`.eh-download-lane[aria-label="${lane==='eh'?'Eh':'Hitomi'} 下载"] .eh-download-card[data-gid="${lane==='eh'?'':'-'}910002"] .eh-download-poster`;
   if(lane!=='grid'){
    await page.getByRole('tab',{name:lane==='eh'?'Eh 下载':'Hitomi 下载',exact:true}).click();
    await page.locator('.eh-download-lane-results').evaluateAll(elements=>{elements[0].scrollTop=145;elements[1].scrollTop=240});
    await page.locator(selector).scrollIntoViewIfNeeded();
   }
   const scrollBefore=entry==='page-eh-download'?await page.locator('.eh-download-lane-results').evaluateAll(elements=>elements.map(e=>e.scrollTop)):null;
   const originBox=await page.locator(selector).boundingBox();
   if(lane==='grid')await page.locator(selector).click();else await page.locator(`${selector} .eh-download-cover-link`).click();
   await verify('enter','#detailCover',`${entry}-${lane}`,originBox);
   assert.equal(await page.evaluate(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').backPage),entry);
   if(lane!=='grid'){
    await page.evaluate(()=>{const n=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation');n.showPage('page-eh-reader');n.showPage('page-detail')});
    await page.waitForTimeout(300);
   }
   await page.getByRole('button',{name:'返回',exact:true}).click();await verify('return',selector,`${entry}-${lane}`);
   if(scrollBefore)assert.deepEqual(await page.locator('.eh-download-lane-results').evaluateAll(elements=>elements.map(e=>e.scrollTop)),scrollBefore,'Both independent download scrolls must survive details');
   const settled=await page.locator(selector).boundingBox();for(const key of ['x','y','width','height'])assert(Math.abs(settled[key]-originBox[key])<.05,`${entry} return to original ${key}`);
   cases++;
  }
 }
 assert.deepEqual(errors,[]);await page.close();
 async function verify(direction,selector,label,origin){
  const flight=page.locator(`.home-detail-flight[data-direction="${direction}"]`);await flight.waitFor({state:'visible'});
  const before=await page.locator(selector).first().boundingBox();
  const animations=await flight.evaluate(e=>e.getAnimations({subtree:true}).map(a=>a.effect.getKeyframes()));assert.equal(animations.length,direction==='return'&&label.startsWith('page-eh-download')?3:2);assert(animations.every(frames=>frames.every(f=>!('width'in f)&&!('height'in f))));
  await flight.evaluate(e=>e.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=180}));
  const mid=await page.locator('.home-detail-flight-frame').boundingBox();assert(mid.width>0);if(origin)assert(mid.width>=Math.min(origin.width,before.width)-1&&mid.width<=Math.max(origin.width,before.width)+1);
  await page.screenshot({path:path.join(os.tmpdir(),`ero-grid-flight-${width}-${theme}-${label}-${direction}-middle.png`)});
  await flight.evaluate(e=>e.getAnimations({subtree:true}).forEach(a=>{a.currentTime=599}));
  const frame=await page.locator('.home-detail-flight-frame').boundingBox(),image=await visibleFlightImage(page),actualImage=await page.locator(`${selector} img`).first().boundingBox();
  await flight.evaluate(e=>e.getAnimations({subtree:true}).forEach(a=>a.play()));await flight.waitFor({state:'detached'});await page.waitForTimeout(250);
  const after=await page.locator(selector).first().boundingBox();for(const key of ['x','y','width','height']){assert(Math.abs(before[key]-after[key])<.05,`Live ${label} ${direction} ${key} shifted ${before[key]} -> ${after[key]}`);assert(Math.abs(frame[key]-after[key])<.3,`Frame ${label} ${direction} ${key} missed`);assert(Math.abs(image[key]-actualImage[key])<.3,`Image ${label} ${direction} ${key} missed`)}
 }
}
console.log(`PASS ${cases} grid/download cases: both directions, three sizes, light/dark, two local cover layers without animated sizes, stable endpoints, both download scroll positions and reader return chain`);
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
