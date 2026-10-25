const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {visibleFlightImage,flightViewport}=require('./cover-flight-qa.cjs');
const out=process.env.ERO_DOWNLOAD_CLIP_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'ero-download-flight-clip-'));
const baseline=process.env.ERO_DOWNLOAD_CLIP_BASELINE==='1';
const admission=process.env.ERO_DOWNLOAD_CLIP_SCENARIO==='admission';
fs.mkdirSync(out,{recursive:true});
const boxOf=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
const intersect=(a,b)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);return{x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)}};
const pixels=String.raw`
from PIL import Image
import json,sys
c=json.loads(sys.argv[1]);im=Image.open(c['file']).convert('RGB');v=c['viewport']
bad=[];seen=0
for y in range(max(0,int(c['image']['y'])),min(im.height,int(c['image']['y']+c['image']['height']))):
 for x in range(max(0,int(c['image']['x'])),min(im.width,int(c['image']['x']+c['image']['width']))):
  r,g,b=im.getpixel((x,y))
  if r>245 and g<8 and b>190:
   if v['x']-1<=x<=v['x']+v['width']+1 and v['y']-1<=y<=v['y']+v['height']+1:seen+=1
   else:bad.append([x,y])
print(json.dumps({'leakedPixels':len(bad),'visiblePixels':seen,'examples':bad[:5]}))
`;
(async()=>{
 const browser=await chromium.launch();const reports=[];
 try{
  for(const[width,height]of baseline?[[1920,900]]:[[1920,900],[1366,768],[1280,720]])for(const theme of baseline?['light']:['light','dark']){
   const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(process.env.ERO_PREVIEW_URL||'http://127.0.0.1:1422');await page.locator('.startup-screen').waitFor({state:'detached'});
   await page.evaluate(theme=>{
    document.documentElement.dataset.theme=theme;
    const stores=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s,d=stores.get('ehDownload'),l=stores.get('ehLibrary');
    const canvas=document.createElement('canvas');canvas.width=360;canvas.height=480;const ctx=canvas.getContext('2d');ctx.fillStyle='#ff00cc';ctx.fillRect(0,0,360,480);window.__clipMarker=canvas.toDataURL();ctx.fillStyle='#a0a9b3';ctx.fillRect(0,0,360,480);window.__clipNeutral=canvas.toDataURL();
    for(const source of ['eh','hitomi']){
     const item=d.history.find(h=>h.source===source&&!h.error&&h.totalPages>0&&h.failedPages.length===0),gallery=l.galleries.find(g=>g.gid===item.gid);
     for(let i=0;i<14;i++){const gid=(source==='eh'?1:-1)*(920000+i),coverPath=`mock://flight-clip/${source}/${gid}`;d.history.push({...item,gid,coverPath,queuedAt:new Date(Date.parse(item.queuedAt)-i*60000-6000000).toISOString()});l.galleries.push({...gallery,gid,cover_path:coverPath});l.coverCache[coverPath]=window.__clipNeutral;}
    }
    stores.get('navigation').showPage('page-eh-download');
    const original=Element.prototype.animate;Element.prototype.animate=function(frames,options){const a=original.call(this,frames,options);if(this.matches('.home-detail-flight,.home-detail-flight-frame,.home-detail-flight-image')){a.pause();a.currentTime=0;}return a;};
   },theme);
   await page.waitForTimeout(600);
   for(const lane of baseline?['eh']:['eh','hitomi'])for(const edge of baseline||admission?['bottom']:['bottom','top']){
    await page.getByRole('tab',{name:lane==='eh'?'Eh 下载':'Hitomi 下载',exact:true}).click();
    await page.evaluate(lane=>{const library=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehLibrary');for(const gallery of library.galleries)if(gallery.cover_path.startsWith('mock://flight-clip/'))library.coverCache[gallery.cover_path]=window.__clipNeutral;library.coverCache[`mock://flight-clip/${lane}/${lane==='eh'?'':'-'}920002`]=window.__clipMarker;},lane);
    const laneElement=page.locator(`.eh-download-lane[aria-label="${lane==='eh'?'Eh':'Hitomi'} 下载"]`),pane=laneElement.locator('.eh-download-lane-results');
    const selector=`.eh-download-card[data-gid="${lane==='eh'?'':'-'}920002"] .eh-download-poster`,poster=laneElement.locator(selector);
    const viewport=await pane.evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x+e.clientLeft,y:r.y+e.clientTop,width:e.clientWidth,height:e.clientHeight}});
    const posterBox=await poster.evaluate(boxOf);
    const top=edge==='bottom'?viewport.y+viewport.height-posterBox.height*.45:viewport.y-posterBox.height*.55;
    await pane.evaluate((e,delta)=>{e.scrollTop+=delta},posterBox.y-top);await page.waitForTimeout(150);
    const origin=await poster.evaluate(boxOf),visible=intersect(origin,viewport);
    assert(visible.height>30&&visible.height<origin.height*.6,JSON.stringify({width,lane,edge,origin,visible}));
    const scrollBefore=await page.locator('.eh-download-lane-results').evaluateAll(es=>es.map(e=>e.scrollTop));
    const clickX=visible.x+visible.width/2,clickY=visible.y+visible.height/2;
    await page.mouse.click(clickX,clickY);
    await page.locator('.home-detail-flight[data-direction=enter]').waitFor({state:'visible'});
    const start=await visibleFlightImage(page);if(!baseline)for(const key of ['x','y','width','height'])assert(Math.abs(start[key]-visible[key])<.1,`Partial source exposed: ${JSON.stringify({width,lane,edge,key,start,visible})}`);
    const prefix=path.join(out,`${width}-${theme}-${lane}-${edge}`);
    await page.screenshot({path:prefix+'-enter-0.png'});
    const overflowPoint={x:Math.round(origin.x+origin.width/2),y:Math.round(edge==='bottom'?viewport.y+viewport.height+8:viewport.y-8)};
    const enterPixels=spawnSync('D:/Envirnment/python/python312/python.exe',['-c',pixels,JSON.stringify({file:prefix+'-enter-0.png',viewport,image:origin})],{encoding:'utf8'});
    assert.equal(enterPixels.status,0,enterPixels.stderr);if(!baseline)assert.equal(JSON.parse(enterPixels.stdout).leakedPixels,0,`Enter leaked outside original viewport: ${enterPixels.stdout}`);
    await play(page);await page.locator('.home-detail-flight').waitFor({state:'detached'});await page.waitForTimeout(100);
    if(admission){
     await page.evaluate(({lane,seed})=>{
      const stores=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s,d=stores.get('ehDownload'),l=stores.get('ehLibrary');
      const original=d.history.find(h=>h.gid===(lane==='eh'?920002:-920002)),gallery=l.galleries.find(g=>g.gid===original.gid);
      for(let i=0;i<5;i++){const gid=(lane==='eh'?1:-1)*(930000+seed*10+i),coverPath=`mock://admission/${gid}`;d.history.push({...original,gid,coverPath,queuedAt:new Date(Date.now()+i*1000).toISOString()});l.galleries.push({...gallery,gid,cover_path:coverPath});l.coverCache[coverPath]=window.__clipNeutral;}
     },{lane,seed:reports.length});await page.waitForTimeout(150);
    }
    const detailImage=await page.locator('#detailCover img').evaluate(boxOf);
    await page.getByRole('button',{name:'返回',exact:true}).click();const flight=page.locator('.home-detail-flight[data-direction=return]');await flight.waitFor({state:'visible'});
    if(!baseline){assert.equal(await flight.evaluate(e=>e.parentElement.classList.contains('eh-download-lane-results')),true,'Return layer escaped the local scroll content');
    assert.equal(await flight.evaluate(e=>getComputedStyle(e.parentElement).isolation),'isolate');}
    const scrollReturned=await page.locator('.eh-download-lane-results').evaluateAll(es=>es.map(e=>e.scrollTop));
    const landing=await poster.evaluate(boxOf),expectedVisible=intersect(landing,viewport);
    // 新入列可能改变作品所在列；只恢复纵向锚点，横向必须飞往排序后的真实卡片，不能为保位置改排序。
    if(admission){const index=lane==='eh'?0:1;assert(scrollReturned[index]>scrollBefore[index]+100,'New row did not exercise scroll anchoring');assert.equal(scrollReturned[1-index],scrollBefore[1-index],'Other lane scroll changed');for(const key of ['y','width','height'])assert(Math.abs(landing[key]-origin[key])<1.1,`Admission moved target ${key}: ${JSON.stringify({landing,origin})}`);}
    else assert.deepEqual(scrollReturned,scrollBefore);
    const samples=[];
    for(const time of [0,16,32,100,300,500,599]){
     await flight.evaluate((e,time)=>e.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=time}),time);
     const mask=await flightViewport(page),full=await visibleFlightImage(page),painted=intersect(full,mask||viewport),file=prefix+`-return-${time}.png`;
     if(!baseline&&time===0)for(const key of ['x','y','width','height'])assert(Math.abs(painted[key]-detailImage[key])<.1,`First return frame cropped the detail before motion: ${JSON.stringify({lane,edge,key,painted,detailImage})}`);
     await page.screenshot({path:file});
     const check=spawnSync('D:/Envirnment/python/python312/python.exe',['-c',pixels,JSON.stringify({file,viewport:mask||viewport,image:full})],{encoding:'utf8'});
     assert.equal(check.status,0,check.stderr);const result=JSON.parse(check.stdout);if(!baseline){assert.equal(result.leakedPixels,0,`Return escaped its moving clip: ${JSON.stringify({width,lane,edge,time,result})}`);assert(result.visiblePixels>painted.width*painted.height*.9,`Cover disappeared during travel: ${JSON.stringify({width,lane,edge,time,result,painted})}`);}
     samples.push({time,full,painted,mask,...result});
    }
    const last=samples.at(-1).painted;for(const key of ['x','y','width','height'])assert(Math.abs(last[key]-expectedVisible[key])<.15,`End crop jumps at ${key}`);
    await play(page);await flight.waitFor({state:'detached'});await page.waitForTimeout(150);
    assert.deepEqual(await page.locator('.eh-download-lane-results').evaluateAll(es=>es.map(e=>e.scrollTop)),scrollReturned);
    reports.push({width,height,theme,lane,edge,admission,scrollBefore,scrollReturned,viewport,origin,visible,overflowPoint,samples});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(reports,null,2));
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log(baseline?`BASELINE ${reports.length} old partial cover motion recorded. Evidence: ${out}`:`PASS ${reports.length} partial download cover round-trips: ${admission?'new admissions during details with anchored landing and independent lane scroll':'top/bottom partial covers'}, both lanes, three sizes/light-dark; full detail at return frame zero, visible pixels throughout travel, moving mask, local layering and continuous landing. Evidence: ${out}`);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
function play(page){return page.locator('.home-detail-flight').evaluate(e=>e.getAnimations({subtree:true}).forEach(a=>a.play()));}
