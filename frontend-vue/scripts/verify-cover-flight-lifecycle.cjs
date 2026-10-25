const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1366,height:768}});
  await page.addInitScript(()=>{
   const original=Element.prototype.animate;window.__holdCover=true;
   Element.prototype.animate=function(frames,options){const a=original.call(this,frames,options);if(window.__holdCover&&this.matches('.home-detail-flight,.home-detail-flight-frame,.home-detail-flight-image')){a.pause();a.currentTime=0;}return a;};
  });
  await page.goto(process.env.ERO_PREVIEW_URL||'http://127.0.0.1:1422');
  await page.waitForFunction(()=>{const h=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('home');return h?.media.current&&h?.book.current&&h.media.phase==='idle'&&h.book.phase==='idle'});
  const cover=page.locator('.home-draw-media .home-draw-cover');
  const showHome=async()=>{await page.evaluate(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').showPage('page-home'));await cover.waitFor({state:'visible'});await page.waitForTimeout(300);};
  const enter=async()=>{await cover.click();await page.locator('.home-detail-flight[data-direction=enter]').waitFor({state:'visible'});};
  const play=()=>page.locator('.home-detail-flight').evaluate(e=>e.getAnimations({subtree:true}).forEach(a=>a.play()));
  await enter();await page.setViewportSize({width:1280,height:720});await page.locator('.home-detail-flight').waitFor({state:'detached'});
  await showHome();await enter();await page.evaluate(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').showPage('page-settings'));await page.locator('.home-detail-flight').waitFor({state:'detached'});
  await showHome();await enter();
  await page.getByRole('button',{name:'返回',exact:true}).click();await play();
  await page.locator('.home-detail-flight[data-direction=return]').waitFor({state:'visible'});await play();await page.locator('.home-detail-flight').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').activePage),'page-home');
  await page.waitForTimeout(300);
  await cover.dblclick();
  await page.waitForFunction(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('home').media.phase==='opening');
  assert.equal(await page.locator('.home-draw-media .home-draw-flipper').evaluate(e=>getComputedStyle(e).animationDuration),'1.1s');
  assert.equal(await page.locator('.home-detail-flight').count(),0);
  await page.waitForFunction(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('home').media.phase==='idle');
  await page.evaluate(()=>{
   window.__holdCover=false;window.__coverFrameTimes=[];let previous=0,count=0;
   function frame(now){if(document.querySelector('.home-detail-flight.is-visible')){if(previous)window.__coverFrameTimes.push(now-previous);previous=now;}else previous=0;if(++count<180)requestAnimationFrame(frame);}
   requestAnimationFrame(frame);
  });
  await cover.click();await page.locator('.home-detail-flight[data-direction=enter]').waitFor({state:'visible'});await page.locator('.home-detail-flight').waitFor({state:'detached'});
  await page.getByRole('button',{name:'返回',exact:true}).click();await page.locator('.home-detail-flight[data-direction=return]').waitFor({state:'visible'});await page.locator('.home-detail-flight').waitFor({state:'detached'});
  const intervals=await page.evaluate(()=>window.__coverFrameTimes),sorted=[...intervals].sort((a,b)=>a-b);
  assert(sorted.length>=30,'Too few frame samples for the two real-time motions');
  const report={status:'PASS resize/unrelated navigation cancellation, queued return, next-entry recovery, double-click 1.1s draw retained',samples:sorted.length,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:Math.max(...sorted),over50ms:sorted.filter(v=>v>50).length};
  const out=process.env.ERO_COVER_LIFECYCLE_REPORT||path.join(os.tmpdir(),'ero-cover-lifecycle.json');fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,report:out}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
