const {chromium}=require('playwright');const assert=require('node:assert/strict');const path=require('node:path');const os=require('node:os');
(async()=>{const browser=await chromium.launch();let cases=0;try{
for(const[width,height]of [[1920,1080],[1366,768],[1280,720]])for(const theme of ['light','dark']){
const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.HAND_QA_URL||'http://127.0.0.1:1422');await page.waitForFunction(()=>{const h=document.getElementById('app')?.__vue_app__?.config.globalProperties.$pinia._s.get('home');return h?.media.current&&h?.book.current&&h.media.phase==='idle'&&h.book.phase==='idle'});
await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.startViewTransition=()=>{throw new Error('Full-page snapshot must not be used')}} ,theme);
for(const kind of ['media','book']){await page.locator(`.home-draw-${kind} .home-draw-cover`).click();await verify('enter','#detailCover',kind);await page.getByRole('button',{name:'返回',exact:true}).click();await verify('return',`.home-draw-${kind} .home-draw-front`,kind);cases++}
await page.evaluate(()=>{const p=document.getElementById('app').__vue_app__.config.globalProperties.$pinia;const h=p._s.get('home');const hand=p._s.get('homeHand');hand.add('media',h.media.current);hand.add('book',h.book.current)});
await page.locator('.home-hand-card.is-main').click();await page.waitForFunction(()=>document.querySelector('.home-hand')?.classList.contains('is-expanded')&&!document.querySelector('.home-hand')?.classList.contains('is-layout-changing'));
for(const kind of ['book','media']){
if(kind==='media'){await page.evaluate(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('homeHand').select(0));await page.waitForTimeout(450)}
const id=await page.evaluate(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('homeHand').current.id);
await page.locator('.home-hand-card.is-main').click();await verify('enter','#detailCover',`hand-${kind}`);assert.equal(await page.evaluate(()=>{const p=document.getElementById('app').__vue_app__.config.globalProperties.$pinia;return p._s.get('navigation').detailSource==='eh'?p._s.get('ehLibrary').currentGallery.gid:p._s.get('library').currentDetailWorkId}),id);
await page.getByRole('button',{name:'返回',exact:true}).click();await verify('return','.home-hand-card.is-main',`hand-${kind}`);assert(await page.locator('.home-hand').evaluate(e=>e.classList.contains('is-expanded')));cases++}
assert.deepEqual(errors,[]);await page.close();
async function verify(direction,selector,label){
const flight=page.locator(`.home-detail-flight[data-direction="${direction}"]`);await flight.waitFor({state:'visible'});
const before=await page.locator(selector).first().boundingBox();
const animations=await page.locator('.home-detail-flight').evaluate(e=>{const a=e.getAnimations({subtree:true});if(a.length!==2)throw new Error('Expected only frame/image motion');return a.map(m=>m.effect.getKeyframes())});assert(animations.every(frames=>frames.every(f=>!('width'in f)&&!('height'in f))));
await page.locator('.home-detail-flight').evaluate(e=>{for(const a of e.getAnimations({subtree:true})){a.pause();a.currentTime=599}});
const frame=await page.locator('.home-detail-flight-frame').boundingBox();const image=await page.locator('.home-detail-flight-image').boundingBox();const actualImage=await page.locator(`${selector} img`).first().boundingBox();
await page.screenshot({path:path.join(os.tmpdir(),`ero-local-flight-${width}-${theme}-${label}-${direction}.png`)});
await page.locator('.home-detail-flight').evaluate(e=>e.getAnimations({subtree:true}).forEach(a=>a.play()));await page.locator('.home-detail-flight').waitFor({state:'detached'});await page.waitForTimeout(240);const after=await page.locator(selector).first().boundingBox();for(const key of ['x','y','width','height']){assert(Math.abs(before[key]-after[key])<.03,`Live ${label} ${direction} ${key} shifted`);assert(Math.abs(frame[key]-after[key])<.3,`Frame ${label} ${direction} ${key} missed ${frame[key]} vs ${after[key]}`);assert(Math.abs(image[key]-actualImage[key])<.3,`Image ${label} ${direction} ${key} missed`)}
}
}
console.log(`PASS ${cases} main/hand layouts: no page snapshots; two transform-only layers; image/frame endpoint continuity and correct return origin`);
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
