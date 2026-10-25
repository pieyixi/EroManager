const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const out=process.env.ERO_RANDOM_QA_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'ero-random-playback-'));
fs.mkdirSync(out,{recursive:true});
// 只替换原生传输层。页面、控制器、EOF 轮询、偏好和账号数据均运行实际源码。
const mpvFixture=String.raw`
const state=window.__mpvFixture={props:{'time-pos':0,duration:120,pause:false,mute:false,speed:1,'eof-reached':false,path:''},commands:[],properties:[]};
let notify=()=>{};
export const delay=async()=>{};
export const initLibMpv=async()=>{};
export const listenMpvEvents=async fn=>{notify=fn;return()=>{notify=()=>{}}};
export const mpvPlugin=async()=>{};
export const mpvGetProperty=async name=>state.props[name]??null;
export const safeMpvGetProperty=mpvGetProperty;
export const mpvSetProperty=async(name,value)=>{state.properties.push({name,value});state.props[name]=value};
export const mpvCommand=async(name,args=[])=>{
 state.commands.push({name,args});
 if(name==='loadfile'){Object.assign(state.props,{path:args[0],'time-pos':0,'eof-reached':Boolean(state.instantEnd),pause:false});notify({event:'file-loaded'});notify({event:'playback-restart'});}
 if(name==='seek')state.props['time-pos']=args[0];
 if(name==='stop')state.props.pause=true;
};`;
const snapshot=()=>{const s=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;return{work:s.get('library').currentDetail?.work.id,episode:s.get('player').episode?.number,path:s.get('player').episode?.video_path,loading:s.get('player').videoLoading,mode:s.get('player').loopMode,time:s.get('player').currentTime}};
(async()=>{const browser=await chromium.launch();const reports=[];try{
 for(const[width,height]of process.env.ERO_RANDOM_EOF_EDGE_ONLY==='1'?[]:[[1920,1080],[1366,768],[1280,720]])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/\/src\/features\/player\/mpv\.ts(?:\?.*)?$/,r=>r.fulfill({contentType:'text/javascript',body:mpvFixture}));
  await page.goto(process.env.ERO_PREVIEW_URL||'http://127.0.0.1:1422');await page.locator('.startup-screen').waitFor({state:'detached'});await page.waitForTimeout(1200);
  await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').showPage('page-settings')},theme);
  const loop=page.getByRole('button',{name:'循环方式',exact:true});await loop.click();
  assert.deepEqual(await page.getByRole('listbox',{name:'循环方式'}).getByRole('option').allTextContents(),['不循环','单集循环','列表循环','随机播放']);
  await page.getByRole('option',{name:'随机播放',exact:true}).click();await page.waitForTimeout(250);
  assert(await page.getByRole('switch',{name:'自动下一集',exact:true}).isChecked());assert(await page.getByRole('switch',{name:'自动下一集',exact:true}).isDisabled());
  await page.screenshot({path:path.join(out,`${width}-${theme}-settings.png`)});
  await page.evaluate(async()=>{const stores=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;await stores.get('preferences').flush();await stores.get('library').showDetail(1,'page-home');const {playerCommands}=await import('/src/features/player/commands.ts');await playerCommands.openPlayer(1);});
  await page.waitForFunction(()=>!document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player').videoLoading);
  await page.getByRole('button',{name:'播放设置',exact:true}).hover();await page.waitForTimeout(200);
  const options=page.locator('.settings-popover [data-loop-mode]');assert.deepEqual(await options.allTextContents(),['不循环','单集循环','列表循环','随机播放']);
  await page.locator('[data-loop-mode="off"]').click();await page.getByRole('button',{name:'播放设置',exact:true}).hover();await page.locator('[data-loop-mode="random"]').click();
  assert.equal((await page.evaluate(snapshot)).mode,'random');
  await page.getByRole('button',{name:'播放设置',exact:true}).hover();await page.screenshot({path:path.join(out,`${width}-${theme}-player.png`)});
  await page.evaluate(async()=>{const {preferencesApi}=await import('/src/api/commands/preferences.ts');await preferencesApi.setRecord({kind:'media',content_id:1,position:67,pair_offset:1,merged_pairs:[]});window.__mpvFixture.commands=[];
   const {accountApi}=await import('/src/api/commands/accounts.ts'),set=accountApi.set;window.__commitWaiting=false;window.__commitReleased=false;
   accountApi.set=async(...args)=>{if(args[0]==='draw'&&args[1]==='playback'&&JSON.parse(args[2]).seen.length>1&&!window.__commitWaiting){window.__commitWaiting=true;await new Promise(resolve=>{window.__releaseCommit=()=>{window.__commitReleased=true;resolve()}});}return set(...args)};
  });
  const transitions=[];
  for(const expected of [{work:1,episode:2},{work:1,episode:3},{episode:1},{episode:2}]){
   const before=await page.evaluate(snapshot);await page.evaluate(()=>window.__mpvFixture.props['eof-reached']=true);
   // 新作品已开始，但轮次写入仍阻塞：期间到来的 EOF 不能被标记成已消费而丢失。
   if(await page.evaluate(()=>window.__commitWaiting&&!window.__commitReleased)){await page.waitForTimeout(650);assert.equal((await page.evaluate(snapshot)).path,before.path);await page.evaluate(()=>window.__releaseCommit());}
   await page.waitForFunction(previous=>{const stores=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s,p=stores.get('player');return p.episode?.video_path!==previous.path&&!p.videoLoading;},before);
   const after=await page.evaluate(snapshot);assert.equal(after.episode,expected.episode);if(expected.work)assert.equal(after.work,expected.work);else if(expected.episode===1)assert.notEqual(after.work,1);
   assert.equal(after.time,0,'Random continuation resumed an old episode position');transitions.push(after);
  }
  const commands=await page.evaluate(()=>window.__mpvFixture.commands);assert(!commands.some(c=>c.name==='seek'),'Random continuation should never restore old progress');
  assert.equal(commands.filter(c=>c.name==='loadfile').length,4,'EOF polling duplicated an advance');
  await page.waitForTimeout(550);assert.equal((await page.evaluate(snapshot)).path,transitions.at(-1).path,'Spurious advance without EOF');
  // 回设置页后模式、已开启但锁定的开关、个人偏好均保持；退出随机时恢复原 auto-next=false。
  await page.evaluate(async()=>{const {playerCommands}=await import('/src/features/player/commands.ts');await playerCommands.returnFromPlayer();document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('navigation').showPage('page-settings')});
  assert.equal(await loop.locator('.settings-select-value').textContent(),'随机播放');await loop.click();await page.getByRole('option',{name:'列表循环',exact:true}).click();
  assert(!(await page.getByRole('switch',{name:'自动下一集',exact:true}).isChecked()));assert(!(await page.getByRole('switch',{name:'自动下一集',exact:true}).isDisabled()));
  await page.evaluate(async()=>{const p=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('preferences');p.update({player_loop:'random'});await p.flush()});await page.reload();await page.locator('.startup-screen').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('preferences').values.player_loop),'random');
  assert.deepEqual(errors,[]);reports.push({width,height,theme,transitions,loads:commands.filter(c=>c.name==='loadfile'),status:'PASS'});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(reports,null,2));await page.close();
 }
 const edge=await browser.newPage();
 await edge.route(/\/src\/features\/player\/mpv\.ts(?:\?.*)?$/,r=>r.fulfill({contentType:'text/javascript',body:mpvFixture}));
 await edge.goto(process.env.ERO_PREVIEW_URL||'http://127.0.0.1:1422');await edge.locator('.startup-screen').waitFor({state:'detached'});
 await edge.evaluate(async()=>{const s=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;s.get('preferences').update({player_loop:'random'});window.__mpvFixture.instantEnd=true;await s.get('library').showDetail(1);const {playerCommands}=await import('/src/features/player/commands.ts');await playerCommands.openPlayer(1)});
 await edge.waitForFunction(()=>window.__mpvFixture.commands.filter(c=>c.name==='loadfile').length>=6);
 const immediate=await edge.evaluate(()=>{window.__mpvFixture.instantEnd=false;window.__mpvFixture.props['eof-reached']=false;return window.__mpvFixture.commands.filter(c=>c.name==='loadfile').map(c=>c.args[0])});
 assert.deepEqual(immediate.slice(0,3),['mock://video/1/1','mock://video/1/2','mock://video/1/3']);assert(!immediate[3].startsWith('mock://video/1/'));assert(immediate[3].endsWith('/1'));
 fs.writeFileSync(path.join(out,'immediate-eof.json'),JSON.stringify({status:'PASS EOF during loading is deferred, never lost',loads:immediate},null,2));await edge.close();
 console.log(`PASS ${reports.length} layout/continuation cases plus immediate-EOF loading edge: menu order, synchronized mode, reload persistence, ordered work-level continuation, zero resume seek, no duplicate/lost advances and ordinary auto-next restoration. Native mpv transport simulated. Evidence: ${out}`);
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
