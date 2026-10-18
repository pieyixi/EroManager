const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const os=require('node:os');
const python='D:/Envirnment/python/python312/python.exe';
const pixelCheck=String.raw`
from PIL import Image
import json,math,sys
case=json.loads(sys.argv[1]); old=Image.open(case['old']).convert('RGB'); new=Image.open(case['new']).convert('RGB')
palette={(247,248,250),(255,255,255),(243,244,246),(233,237,242),(24,26,31),(35,38,45),(32,35,41),(45,49,57),(43,47,55)}
samples=[(x,y) for x in range(110,old.width-20,55) for y in range(90,old.height-20,55) if old.getpixel((x,y)) in palette and new.getpixel((x,y)) in palette and sum(abs(a-b) for a,b in zip(old.getpixel((x,y)),new.getpixel((x,y))))>80]
results=[]
for frame in case['frames']:
 im=Image.open(frame['file']).convert('RGB'); r,x0,y0=frame['clip']; checked=inside=outside=0; errors=[]
 for x,y in samples:
  distance=math.hypot(x-x0,y-y0)
  if abs(distance-r)<10: continue
  within=distance<r; inside+=within; outside+=not within
  use_old=within if case['next']=='light' else not within
  expected=(old if use_old else new).getpixel((x,y)); actual=im.getpixel((x,y)); checked+=1
  if max(abs(a-b) for a,b in zip(expected,actual))>3: errors.append({'at':[x,y],'expected':expected,'actual':actual})
 results.append({'time':frame['time'],'checked':checked,'inside':inside,'outside':outside,'errors':errors[:8],'count':len(errors)})
print(json.dumps(results))
`;
(async()=>{
 const browser=await chromium.launch();let transitions=0;
 try{
  for(const [width,height] of [[1920,1080],[1366,768],[1280,720]])for(const entry of ['page-home','page-media-library','page-eh-library','page-settings'])await verify(width,height,entry);
  console.log(`PASS ${transitions} sidebar reveals: old theme preserved until snapshot commit; no soft-color race; 0ms/120ms screenshot pixels follow the same expanding/shrinking circle across home/media/books/settings and three sizes; settings soft path retained.`);
 }finally{await browser.close()}
 async function verify(width,height,entry){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   localStorage.setItem('media-library-theme','light');localStorage.setItem('media-library-theme-mode','light');localStorage.setItem('ero-browser-preferences-v1',JSON.stringify({theme:'light'}));
   window.__themeEvents=[];
   const record=event=>window.__themeEvents.push({event,theme:document.documentElement.dataset.theme,soft:document.documentElement.dataset.themeSoft||null});
   const start=document.startViewTransition.bind(document);
   document.startViewTransition=callback=>{record('start');return start(()=>{record('before-commit');const result=callback();record('after-commit');return result})};
   const animate=Element.prototype.animate;
   Element.prototype.animate=function(keyframes,options){const animation=animate.call(this,keyframes,options);
    if(this===document.documentElement&&options?.pseudoElement?.startsWith('::view-transition')){animation.pause();animation.currentTime=0;window.__themeAnimation={animation,options,keyframes};}
    return animation;
   };
  });
  await page.goto('http://127.0.0.1:1422/?preview=settings');await page.locator('.startup-screen').waitFor({state:'detached'});
  await page.evaluate(entry=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').showPage(entry),entry);await page.waitForTimeout(1450);
  for(const next of ['dark','light']){
   const oldTheme=next==='dark'?'light':'dark',prefix=path.join(os.tmpdir(),`ero-theme-${width}-${entry}-${next}`);
   const button=page.getByRole('button',{name:next==='dark'?'切换到深色模式':'切换到浅色模式',exact:true});
   await button.hover();await page.waitForTimeout(160);const oldFile=`${prefix}-old.png`,newFile=`${prefix}-new.png`;
   await page.screenshot({path:oldFile});await page.evaluate(()=>{window.__themeEvents=[];window.__themeAnimation=null});await button.click();
   await page.waitForFunction(()=>!!window.__themeAnimation);
   const events=await page.evaluate(()=>window.__themeEvents);
   assert.equal(events.find(e=>e.event==='before-commit').theme,oldTheme,'Preference persistence must not recolor before the old snapshot');
   assert(events.every(e=>e.soft===null),'Sidebar reveal must not run settings soft colors');
   assert.equal(events.find(e=>e.event==='after-commit').theme,next);
   const spec=await page.evaluate(()=>({duration:window.__themeAnimation.options.duration,easing:window.__themeAnimation.options.easing,pseudo:window.__themeAnimation.options.pseudoElement}));
   assert.equal(spec.duration,480);assert.equal(spec.easing,'cubic-bezier(.22,.8,.28,1)');assert.equal(spec.pseudo,next==='dark'?'::view-transition-new(root)':'::view-transition-old(root)');
   const frames=[];
   for(const time of [0,120]){
    const clip=await page.evaluate(async time=>{
     const effect=window.__themeAnimation;effect.animation.currentTime=time;
     await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
     const value=getComputedStyle(document.documentElement,effect.options.pseudoElement).clipPath;
     const parts=value.match(/circle\(([\d.]+)(?:px)? at ([\d.]+)px ([\d.]+)px\)/);if(!parts)throw new Error(`Unexpected clip ${value}`);
     return parts.slice(1).map(Number);
    },time);
    const file=`${prefix}-${time}.png`;await page.screenshot({path:file});frames.push({time,clip,file});
   }
   await page.evaluate(()=>window.__themeAnimation.animation.play());await page.waitForFunction(()=>!document.documentElement.dataset.themeTransition);await page.waitForTimeout(180);
   await page.screenshot({path:newFile});
   const report=spawnSync(python,['-c',pixelCheck,JSON.stringify({old:oldFile,new:newFile,next,frames})],{encoding:'utf8'});
   assert.equal(report.status,0,report.stderr);const checks=JSON.parse(report.stdout);
   for(const check of checks){assert(check.checked>20,JSON.stringify(check));assert.equal(check.count,0,JSON.stringify({width,entry,next,...check}));if(check.time===120)assert(check.inside>3&&check.outside>3,JSON.stringify(check));}
   const state=await page.evaluate(()=>{const stores=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;return{ui:stores.get('ui').theme,preference:stores.get('preferences').values.theme,soft:document.documentElement.dataset.themeSoft||null}});
   assert.deepEqual(state,{ui:next,preference:next,soft:null});transitions++;
  }
  if(entry==='page-settings'&&width===1366){
   await page.evaluate(()=>{window.__themeEvents=[]});
   await page.getByRole('button',{name:'外观',exact:true}).click();await page.getByRole('option',{name:'深色模式',exact:true}).click();
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.themeSoft),'true');assert.deepEqual(await page.evaluate(()=>window.__themeEvents),[]);
   await page.waitForTimeout(300);
  }
  assert.deepEqual(errors,[]);await page.close();
 }
})().catch(e=>{console.error(e);process.exit(1)});
