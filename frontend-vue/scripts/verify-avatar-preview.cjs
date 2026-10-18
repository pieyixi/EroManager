const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const browser=await chromium.launch();let cases=0;
  try{
    for(const [width,height] of [[1920,1080],[1366,768],[1280,720]])for(const theme of ['light','dark'])await verify(width,height,theme,true);
    for(const theme of ['light','dark'])await verify(1366,768,theme,false);
    console.log(`PASS ${cases} inline avatar cases: avatar grows in place, account moves right, all settings/divider move down synchronously, fixed texture, uninterrupted opacity, no modal/backdrop/overflow/scroll jump, collapse/Escape/rapid reversal, pencil/menu isolation, navigation/resize cleanup, images/default and three sizes/themes.`);
  }finally{await browser.close()}
  async function verify(width,height,theme,withImage){
    const page=await browser.newPage({viewport:{width,height}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(theme=>{localStorage.setItem('media-library-theme',theme);localStorage.setItem('media-library-theme-mode',theme);localStorage.setItem('ero-browser-preferences-v1',JSON.stringify({theme}));},theme);
    await page.goto('http://127.0.0.1:1422/?preview=settings');await page.locator('.startup-screen').waitFor({state:'detached'});
    if(withImage)await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d');x.arc(256,256,256,0,Math.PI*2);x.clip();
      const gradient=x.createLinearGradient(0,0,512,512);gradient.addColorStop(0,'#4b77d8');gradient.addColorStop(1,'#a3cbed');x.fillStyle=gradient;x.fillRect(0,0,512,512);
      x.fillStyle='#fff';x.font='bold 180px serif';x.textAlign='center';x.textBaseline='middle';x.fillText('裏',256,270);
      document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('profile').setAvatar(c.toDataURL('image/png'));
    });
    const avatar=page.locator('.profile-avatar-button'),root=page.locator('.settings-profile'),visual=page.locator('.profile-avatar-visual');
    const read=()=>page.evaluate(()=>{
      const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
      return{avatar:rect('.profile-avatar-visual'),summary:rect('.profile-summary'),general:rect('[data-settings-group=general]'),playback:rect('[data-settings-group=playback]'),divider:rect('.profile-divider')};
    });
    const before=await read();assert.equal(before.avatar.width,64);
    await page.evaluate(()=>{window.__avatarFrames=[];window.__avatarSampling=true;
      function step(){
        const e=document.querySelector('.profile-avatar-visual'),summary=document.querySelector('.profile-summary'),general=document.querySelector('[data-settings-group=general]'),playback=document.querySelector('[data-settings-group=playback]'),divider=document.querySelector('.profile-divider');
        const r=e.getBoundingClientRect(),s=summary.getBoundingClientRect();
        window.__avatarFrames.push({phase:e.closest('.settings-profile').dataset.avatarPhase,x:r.x,y:r.y,width:r.width,texture:e.offsetWidth,sx:s.x,sy:s.y,gy:general.getBoundingClientRect().y,py:playback.getBoundingClientRect().y,dy:divider.getBoundingClientRect().y,opacity:getComputedStyle(e).opacity,overflow:document.documentElement.scrollWidth>innerWidth,scroll:document.querySelector('.settings-scroll').scrollTop});
        if(window.__avatarSampling)requestAnimationFrame(step);
      }requestAnimationFrame(step);
    });
    await avatar.click();await page.waitForTimeout(210);
    const middle=await read();assert(middle.avatar.width>64&&middle.avatar.width<256);
    await page.screenshot({path:path.join(os.tmpdir(),`ero-avatar-inline-moving-${width}-${theme}-${withImage}.png`)});
    await root.locator(':scope[data-avatar-phase=expanded]').waitFor();
    const after=await read();assert.equal(after.avatar.width,256);
    assert(Math.abs(after.avatar.x-before.avatar.x)<.1&&Math.abs(after.avatar.y-before.avatar.y)<.1,'Avatar must stay anchored at its original top-left');
    assert(Math.abs(after.summary.x-before.summary.x-192)<.1&&Math.abs(after.summary.y-before.summary.y)<.1,'Account controls must move right without a vertical move');
    for(const key of ['general','playback','divider'])assert(Math.abs(after[key].y-before[key].y-192)<.1,`${key} must move down by the avatar growth`);
    assert.equal(await page.getByRole('dialog').count(),0,'Expanding the avatar must not open a modal or backdrop');
    await page.screenshot({path:path.join(os.tmpdir(),`ero-avatar-inline-expanded-${width}-${theme}-${withImage}.png`)});
    await avatar.click();await root.locator(':scope[data-avatar-phase=collapsed]').waitFor();
    assert.deepEqual(await read(),before);
    const frames=await page.evaluate(()=>{window.__avatarSampling=false;return window.__avatarFrames});
    assert(frames.filter(f=>f.phase==='expanding').length>3&&frames.filter(f=>f.phase==='collapsing').length>3);
    for(const f of frames){
      assert.equal(f.texture,256);assert.equal(f.opacity,'1');assert(!f.overflow&&f.scroll===0);
      const growth=f.width-64;
      assert(Math.abs(f.x-before.avatar.x)<.1&&Math.abs(f.y-before.avatar.y)<.1);
      assert(Math.abs(f.sx-before.summary.x-growth)<.15,'Avatar and horizontal account movement must remain synchronized');
      assert(Math.abs(f.gy-before.general.y-growth)<.15&&Math.abs(f.py-before.playback.y-growth)<.15&&Math.abs(f.dy-before.divider.y-growth)<.15,'All settings and separator must move with the same progress');
    }
    await avatar.click();await root.locator(':scope[data-avatar-phase=expanded]').waitFor();
    await page.getByRole('button',{name:'编辑账号',exact:true}).click();
    const editor=page.getByRole('dialog',{name:'账号资料',exact:true});await editor.waitFor();
    await page.keyboard.press('Escape');await editor.waitFor({state:'detached'});assert.equal(await root.getAttribute('data-avatar-phase'),'expanded');
    await page.getByRole('button',{name:'切换或退出账号',exact:true}).click();await page.keyboard.press('Escape');
    assert.equal(await root.getAttribute('data-avatar-phase'),'expanded');
    await page.keyboard.press('Escape');await root.locator(':scope[data-avatar-phase=collapsed]').waitFor();
    if(width===1366&&withImage){
      const click=()=>page.mouse.click(before.avatar.x+32,before.avatar.y+32);
      await click();await page.waitForTimeout(140);
      await page.evaluate(()=>document.querySelector('.profile-avatar-button').addEventListener('click',()=>{window.__reverseSize=document.querySelector('.profile-avatar-visual').getBoundingClientRect().width;},{capture:true,once:true}));
      await click();await page.waitForTimeout(25);const reversed=await visual.boundingBox(),atClick=await page.evaluate(()=>window.__reverseSize);
      assert(reversed.width<=atClick+.5,`Reversal must start at the actual clicked frame: ${atClick} -> ${reversed.width}`);
      await root.locator(':scope[data-avatar-phase=collapsed]').waitFor();assert.deepEqual(await read(),before);
      await click();await page.waitForTimeout(90);await click();await page.waitForTimeout(90);await click();
      await root.locator(':scope[data-avatar-phase=expanded]').waitFor();assert.equal((await read()).avatar.width,256);
      await page.evaluate(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').showPage('page-home'));
      assert.equal(await root.getAttribute('data-avatar-phase'),'collapsed');
      await page.evaluate(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').showPage('page-settings'));
      await avatar.click();await root.locator(':scope[data-avatar-phase=expanded]').waitFor();await page.setViewportSize({width:width-30,height:height-20});
      await root.locator(':scope[data-avatar-phase=collapsed]').waitFor();assert.equal((await read()).avatar.width,64);
    }
    assert.deepEqual(errors,[]);await page.close();cases++;
  }
})().catch(e=>{console.error(e);process.exit(1)});
