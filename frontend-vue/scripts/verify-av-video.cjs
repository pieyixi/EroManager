const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const output = fs.mkdtempSync(path.join(os.tmpdir(),'ero-av-video-browser-'));
// 复用既有中性 mpv 传输夹具，实际运行播放器控制器、页面、账号和偏好。
const fixture = fs.readFileSync(path.join(__dirname,'verify-random-playback.cjs'),'utf8').match(/const mpvFixture=String.raw`([\s\S]*?)`;/)[1];
const snapshot = () => { const s=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s,p=s.get('player');return {mode:p.mode,id:p.episode?.id,path:p.episode?.video_path,loading:p.videoLoading,time:p.currentTime,loop:p.loopMode,code:p.sourceKey}; };
(async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    for(const [width,height] of [[1920,1080],[1366,768],[1280,720]]) for(const theme of ['light','dark']) {
      const page=await browser.newPage({viewport:{width,height}}), errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.route(/\/src\/features\/player\/mpv\.ts(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:fixture}));
      await page.goto('http://127.0.0.1:1422');await page.locator('.startup-screen').waitFor({state:'hidden'});await page.waitForFunction(()=>!document.querySelector('.window').inert);
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
      await page.getByRole('button',{name:'AV',exact:true}).click();
      assert(await page.locator('[data-code="DEMO-102"] .av-no-video').isVisible());
      assert.equal(await page.locator('[data-code="DEMO-100"] .av-no-video').count(),0);
      assert.equal(await page.locator('[data-code="DEMO-103"] .av-no-video').count(),0);
      await page.screenshot({path:path.join(output,`${width}-${theme}-grid.png`)});
      await page.locator('[data-code="DEMO-100"]').click();await page.locator('.home-detail-flight').waitFor({state:'detached'});
      assert.deepEqual(await page.locator('.av-video-panel .episode-num').allTextContents(),['原版','剪辑版']);
      await page.evaluate(async()=>{const {accountApi}=await import('/src/api/commands/accounts.ts');await accountApi.set('av-playback','DEMO-100:original','{"position":37}');const p=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('preferences');p.update({remember_playback:true,player_loop:'random',player_auto_next:false});await p.flush();});
      await page.locator('.av-video-panel [data-video-kind="original"]').click();await loaded(1);
      assert.equal((await page.evaluate(snapshot)).time,37);assert.equal((await page.evaluate(snapshot)).loop,'off');
      assert.equal(await page.evaluate(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('preferences').values.player_loop),'random');
      assert.match(await page.locator('#playerTitle').textContent(),/DEMO-100.*原版/);
      assert.deepEqual(await page.locator('.player-other-copy>span').allTextContents(),['原版 · 播放中','剪辑版']);
      assert(await page.locator('.player-av-cover').evaluateAll(nodes=>nodes.every(node=>{const img=node.querySelector('img'),frame=node.getBoundingClientRect();return !!img&&img.getBoundingClientRect().height<=frame.height+1&&frame.height<100;})), 'jacket images stay inside the sidebar thumbnail frames');
      await page.evaluate(()=>window.__mpvFixture.props['time-pos']=77);await page.waitForFunction(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player').currentTime===77);
      await page.locator('.player-other-item').nth(1).click();await loaded(2);assert.equal((await page.evaluate(snapshot)).time,0);
      await page.evaluate(()=>window.__mpvFixture.props['time-pos']=19);await page.waitForFunction(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player').currentTime===19);
      await page.screenshot({path:path.join(output,`${width}-${theme}-player.png`)});
      await page.locator('#page-player .player-back-slot button').click();await page.locator('#page-detail').waitFor({state:'visible'});assert(await page.locator('#page-detail').isVisible());
      const records=await page.evaluate(async()=>{const {flushAccountWrites}=await import('/src/api/accountContext.ts');await flushAccountWrites();const {accountApi}=await import('/src/api/commands/accounts.ts');return [await accountApi.get('av-playback','DEMO-100:original'),await accountApi.get('av-playback','DEMO-100:cut')].map(JSON.parse);});
      assert.deepEqual(records,[{position:77},{position:19}]);
      await page.locator('.av-video-panel [data-video-kind="cut"]').click();await loaded(2);assert.equal((await page.evaluate(snapshot)).time,19);
      await page.getByRole('button',{name:'播放设置',exact:true}).hover();await page.locator('[data-loop-mode="all"]').click();
      await page.evaluate(()=>{document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('preferences').update({player_auto_next:true});window.__mpvFixture.props['eof-reached']=true;});
      await loaded(1);assert.equal((await page.evaluate(snapshot)).code,'DEMO-100');
      await page.getByRole('button',{name:'全屏',exact:true}).click();await page.waitForFunction(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player').fullscreen);
      await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player').fullscreen);
      await page.locator('#page-player .player-back-slot button').click();await page.locator('#page-detail').waitFor({state:'visible'});
      await page.getByRole('button',{name:'返回',exact:true}).click();await page.locator('.home-detail-flight').waitFor({state:'detached'});
      await page.locator('[data-code="DEMO-103"]').click();await page.locator('.home-detail-flight').waitFor({state:'detached'});
      assert.deepEqual(await page.locator('.av-video-panel .episode-num').allTextContents(),['剪辑版']);
      await page.locator('.av-video-panel .episode-item').click();await loaded(2);
      assert.equal(await page.locator('.player-other-item').count(),1);
      await page.locator('#page-player .player-back-slot button').click();await page.locator('#page-detail').waitFor({state:'visible'});await page.getByRole('button',{name:'返回',exact:true}).click();await page.locator('.home-detail-flight').waitFor({state:'detached'});
      await page.locator('[data-code="DEMO-102"]').click();await page.locator('.home-detail-flight').waitFor({state:'detached'});
      assert.equal(await page.locator('.av-video-panel').count(),0);
      assert.deepEqual(errors,[]);console.log(`PASS ${width} ${theme}: no-video/cut-only/original order; shared player, variant progress, playlist loop, fullscreen and return`);
      await page.close();
      async function loaded(id){await page.waitForFunction(id=>{const p=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player');return p.mode==='av'&&p.episode?.id===id&&!p.videoLoading&&p.nativeVisible;},id);}
    }
    const delayed=await browser.newPage();
    const lateFixture=fixture.replace('export const delay=async()=>{};', 'export const delay=ms=>new Promise(resolve=>setTimeout(resolve,Math.min(ms,20)));')
      .replace("notify({event:'playback-restart'});", "state.props.duration=0;setTimeout(()=>{state.props.duration=120;notify({event:'playback-restart'});},150);");
    await delayed.route(/\/src\/features\/player\/mpv\.ts(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:lateFixture}));
    await delayed.goto('http://127.0.0.1:1422');await delayed.locator('.startup-screen').waitFor({state:'hidden'});
    await delayed.waitForFunction(()=>!document.querySelector('.window').inert);
    await delayed.getByRole('button',{name:'AV',exact:true}).click();await delayed.locator('[data-code="DEMO-100"]').click();await delayed.locator('.home-detail-flight').waitFor({state:'detached'});
    await delayed.evaluate(async()=>{const {accountApi}=await import('/src/api/commands/accounts.ts');await accountApi.set('av-playback','DEMO-100:original','{"position":45}');const p=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('preferences');p.update({remember_playback:true,player_loop:'off'});await p.flush();});
    await delayed.locator('.av-video-panel [data-video-kind="original"]').click();
    await delayed.waitForFunction(()=>{const p=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player');return p.nativeVisible&&!p.videoLoading;});
    assert.equal((await delayed.evaluate(snapshot)).time,45,'duration unavailable before first frame must not discard resume');
    await delayed.close();console.log('PASS delayed-duration first-frame resume edge');
    console.log(`Native transport simulated; evidence: ${output}`);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
