const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {visibleFlightImage,flightViewport,intersectBoxes}=require('./cover-flight-qa.cjs');
const base=process.env.ERO_PREVIEW_URL||'http://127.0.0.1:1422';
const baseline=process.env.ERO_COVER_QA_BASELINE==='1';
const out=process.env.ERO_COVER_QA_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'ero-cover-smooth-'));
fs.mkdirSync(out,{recursive:true});
const comparePixels=String.raw`
from PIL import Image,ImageChops,ImageStat,ImageFilter
import json,sys,math
c=json.loads(sys.argv[1]);r=c['box'];pad=12
box=(math.ceil(r['x'])+pad,math.ceil(r['y'])+pad,math.floor(r['x']+r['width'])-pad,math.floor(r['y']+r['height'])-pad)
# 网格悬停文字/下载状态属于入口 UI，不属于位图；避开它们，比较真实图片的无遮挡区域。
if c['direction']=='enter' and c['entry'].endswith('-grid'): box=(box[0],box[1],box[2],math.floor(r['y']+r['height']*.45))
if c['direction']=='enter' and c['entry'].startswith('download-'): box=(box[0],math.ceil(r['y'])+40,box[2],box[3])
a=Image.open(c['before']).convert('RGB').crop(box);b=Image.open(c['after']).convert('RGB').crop(box)
# 两端 raster 尺寸不同，低通后比较构图，避开高频网格的抗锯齿差别；原始截图始终保留。
d=ImageChops.difference(a.filter(ImageFilter.GaussianBlur(3)),b.filter(ImageFilter.GaussianBlur(3)));pixels=list(d.get_flattened_data())
print(json.dumps({'mean':sum(ImageStat.Stat(d).mean)/3,'changedFraction':sum(max(p)>12 for p in pixels)/len(pixels)}))
`;
const boxOf=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
(async()=>{
 const browser=await chromium.launch();const reports=[];
 try{
  const sizes=baseline?[[1366,768]]:[[1920,1080],[1366,768],[1280,720]];
  for(const[width,height]of sizes)for(const theme of baseline?['light']:['light','dark']){
   const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base);await page.locator('.startup-screen').waitFor({state:'detached'});
   await page.waitForFunction(()=>{const h=document.getElementById('app')?.__vue_app__?.config.globalProperties.$pinia._s.get('home');return h?.media.current&&h?.book.current&&h.media.phase==='idle'&&h.book.phase==='idle'});
   await page.evaluate(theme=>{
    document.documentElement.dataset.theme=theme;
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){const result=animate.call(this,frames,options);if(this.matches('.home-detail-flight,.home-detail-flight-frame,.home-detail-flight-image')){result.pause();result.currentTime=0;}return result;};
   },theme);
   for(const entry of ['home-media','home-book','media-grid','book-grid','download-eh','download-hitomi']){
    await page.evaluate(entry=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').showPage(entry.startsWith('home-')?'page-home':entry==='media-grid'?'page-media-library':entry==='book-grid'?'page-eh-library':'page-eh-download'),entry);
    await page.waitForTimeout(500);
    await page.evaluate(entry=>{
     const canvas=document.createElement('canvas');canvas.width=entry.includes('media')?640:360;canvas.height=entry.includes('media')?360:480;
     const ctx=canvas.getContext('2d');ctx.fillStyle='#efede5';ctx.fillRect(0,0,canvas.width,canvas.height);
     ctx.strokeStyle='#183b58';ctx.lineWidth=4;
     for(let x=0;x<canvas.width;x+=24){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}
     for(let y=0;y<canvas.height;y+=24){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}
     ctx.fillStyle='#ec5a6b';ctx.beginPath();ctx.arc(canvas.width/2,canvas.height/2,80,0,Math.PI*2);ctx.fill();
     const art=canvas.toDataURL('image/png'),stores=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
     const h=stores.get('home'),m=stores.get('library'),b=stores.get('ehLibrary');
     h.media.current.cover=art;h.book.current.cover=art;
     for(const w of m.works)if(w.cover_path)m.coverCache[w.cover_path]=art;
     for(const g of b.galleries)if(g.cover_path)b.coverCache[g.cover_path]=art;
    },entry);
    let frame,click;
    if(entry.startsWith('home-')){const kind=entry.slice(5);frame=page.locator(`.home-draw-${kind} .home-draw-incoming .home-draw-front`);click=page.locator(`.home-draw-${kind} .home-draw-cover`);}
    else if(entry.endsWith('-grid')){const pageId=entry==='media-grid'?'page-media-library':'page-eh-library';frame=page.locator(`#${pageId} .cover-card .cover-img`).first();click=frame;}
    else{const lane=entry.endsWith('-hitomi')?'Hitomi':'Eh';click=page.locator(`.eh-download-lane[aria-label="${lane} 下载"] .eh-download-cover-link`).first();frame=click.locator('..');}
    await click.hover();await page.waitForTimeout(350);
    await check('enter',frame,click,entry);
    const back=page.getByRole('button',{name:'返回',exact:true});
    await check('return',page.locator('#detailCover'),back,entry);
   }
   assert.deepEqual(errors,[]);await page.close();
   async function check(direction,origin,action,entry){
    const prefix=path.join(out,`${width}-${theme}-${entry}-${direction}`),source=await origin.evaluate(boxOf),imageBox=await origin.locator('img').first().evaluate(boxOf);
    const sourceViewport=await origin.evaluate(e=>{const pane=e.closest('.eh-download-lane-results');if(!pane)return null;const r=pane.getBoundingClientRect();return{x:r.x+pane.clientLeft,y:r.y+pane.clientTop,width:pane.clientWidth,height:pane.clientHeight}});
    await page.screenshot({path:prefix+'-before.png'});await action.click();
    const flight=page.locator(`.home-detail-flight[data-direction="${direction}"]`);await flight.waitFor({state:'visible'});
    await page.waitForTimeout(50);
    const animations=await flight.evaluate(e=>e.getAnimations({subtree:true}).map(a=>({frames:a.effect.getKeyframes(),duration:a.effect.getTiming().duration})));
    assert.equal(animations.length,direction==='return'&&entry.startsWith('download-')?3:2);assert(animations.every(a=>a.duration===600&&a.frames.every(f=>!('width'in f)&&!('height'in f))));
    const first=await page.locator('.home-detail-flight-frame').evaluate(boxOf),visible=await visibleFlightImage(page);
    const expectedImage=sourceViewport?intersectBoxes(imageBox,sourceViewport):imageBox;
    for(const key of ['x','y','width','height']){assert(Math.abs(first[key]-source[key])<.06,`${entry} first frame ${key}`);assert(Math.abs(visible[key]-expectedImage[key])<.06,`${entry} first crop ${key}`);}
    await page.screenshot({path:prefix+'-first.png'});
    // 返回下载列后，表单/滚动区外已按真实层级遮挡；首帧只比较仍可见的那部分。
    const viewport=await flightViewport(page)||sourceViewport,sampleBox=viewport?intersectBoxes(imageBox,viewport):imageBox;
    let difference={mean:0,changedFraction:0,occluded:sampleBox.width<=30||sampleBox.height<=50};
    if(!difference.occluded){const pixels=spawnSync('D:/Envirnment/python/python312/python.exe',['-c',comparePixels,JSON.stringify({entry,direction,box:sampleBox,before:prefix+'-before.png',after:prefix+'-first.png'})],{encoding:'utf8'});assert.equal(pixels.status,0,pixels.stderr);difference=JSON.parse(pixels.stdout);}
    // 位图经合成器缩放会有边缘重采样误差；该门限仍明显低于旧裁切交接的误差（对照报告保留）。
    if(!baseline){assert(difference.mean<6,JSON.stringify({width,theme,entry,direction,...difference}));assert(difference.changedFraction<.17,JSON.stringify({width,theme,entry,direction,...difference}));}
    const samples=[];
    for(const time of [0,60,180,300,450,599]){
     await flight.evaluate((e,time)=>e.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=time}),time);
     const matrix=await page.locator('.home-detail-flight-image').evaluate(e=>{const m=new DOMMatrixReadOnly(getComputedStyle(e).transform);return{x:m.a,y:m.d}});
     if(!baseline)assert(Math.abs(matrix.x-matrix.y)<.00001,`Artwork stretched: ${JSON.stringify({entry,direction,time,matrix})}`);
     if(!baseline&&time>=60&&time<=450){
      const paint=await page.locator('.home-detail-flight-frame').evaluate(e=>{const c=getComputedStyle(e);return{fill:c.backgroundColor,border:c.borderTopColor,shadow:c.boxShadow}});
      const transparent=color=>color==='transparent'||/^rgba\([^)]*,\s*0\)$/.test(color);
      assert(transparent(paint.fill)&&transparent(paint.border),`Traveling card frame must not paint a border: ${JSON.stringify({entry,direction,time,paint})}`);
      assert(paint.shadow==='none'||/^rgba\(0, 0, 0, 0\)/.test(paint.shadow),`Traveling frame must not outline its empty padding: ${JSON.stringify({entry,direction,time,paint})}`);
     }
     const rect=await visibleFlightImage(page);samples.push({time,...rect});
     if(entry==='home-media'&&width===1366&&theme==='light')await page.screenshot({path:prefix+`-${time}.png`});
    }
    const destination=direction==='enter'?page.locator('#detailCover'):originFor(entry);
    const target=await destination.evaluate(boxOf),targetImage=await destination.locator('img').first().evaluate(boxOf),last=samples.at(-1);
    for(const key of ['x','y','width','height'])assert(Math.abs(last[key]-targetImage[key])<.1,`${entry} endpoint crop ${key}`);
    await flight.evaluate(e=>e.getAnimations({subtree:true}).forEach(a=>a.play()));await flight.waitFor({state:'detached'});
    await page.waitForTimeout(250);
    const settled=await destination.evaluate(boxOf);for(const key of ['x','y','width','height'])assert(Math.abs(target[key]-settled[key])<.05,`${entry} endpoint jumps at ${key}`);
    reports.push({width,height,theme,entry,direction,pixelFilter:'GaussianBlur(3), unobstructed image region',difference,samples});
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(reports,null,2));
   }
   function originFor(entry){
    if(entry.startsWith('home-'))return page.locator(`.home-draw-${entry.slice(5)} .home-draw-incoming .home-draw-front`);
    if(entry.endsWith('-grid'))return page.locator(`#${entry==='media-grid'?'page-media-library':'page-eh-library'} .cover-card .cover-img`).first();
    return page.locator(`.eh-download-lane[aria-label="${entry.endsWith('-hitomi')?'Hitomi':'Eh'} 下载"] .eh-download-cover-link`).first().locator('..');
   }
  }
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(reports,null,2));
  console.log(baseline?`BASELINE ${reports.length} old handoffs recorded for pixel comparison. Evidence: ${out}`:`PASS ${reports.length} cover handoffs: first-frame pixels, unchanged artwork proportions, continuous crops, 600ms/two painted cover layers with synchronized return mask, stable return. Evidence: ${out}`);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
