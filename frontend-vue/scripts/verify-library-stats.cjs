const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const browser=await chromium.launch(); let cases=0;
  try {
    for(const [width,height] of [[1920,1080],[1366,768],[1280,720]]) for(const theme of ['light','dark']) await verify({width,height,theme});
    for(const mode of ['empty','long','unbound']) for(const theme of ['light','dark']) await verify({mode,theme});
    await verify({mode:'refresh'});
    console.log(`PASS ${cases} statistics cases: reference style, top five, percentages/averages, empty/long/unbound, refresh/error retention, navigation and dialog dismissal.`);
  } finally {await browser.close();}
  async function verify({width=1366,height=768,theme='light',mode='normal'}={}){
    const page=await browser.newPage({viewport:{width,height}});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(theme=>{
      localStorage.setItem('media-library-theme',theme);
      localStorage.setItem('media-library-theme-mode',theme);
      localStorage.setItem('ero-browser-preferences-v1',JSON.stringify({theme}));
    },theme);
    if(mode==='refresh') await page.route('**/src/api/webMock.ts*',async route=>{
      const response=await route.fetch();let body=await response.text();
      body=body.replace('const handler = handlers[command];',`
        if(window.__statsDelay && ['get_library_console_summary','eh_get_library_dashboard'].includes(command)) {
          await new Promise(r=>setTimeout(r,700));
          if(window.__statsFail) throw new Error('fixture stats unavailable');
        }
        const handler = handlers[command];`);
      await route.fulfill({response,body});
    });
    await page.goto('http://127.0.0.1:1422/?preview=settings');
    await page.locator('.startup-screen').waitFor({state:'detached'});
    await page.getByRole('button',{name:'查看数据',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'资料库数据'});
    await page.getByRole('button',{name:'刷新统计',exact:true}).waitFor();
    await page.waitForFunction(()=>!document.querySelector('.library-stats-content-enter-active,.library-stats-content-leave-active'));
    await page.evaluate(mode=>{
      const stores=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
      const media=stores.get('libraryConsole'),books=stores.get('ehSettings');
      media.mediaPath='D:\\HAnime';media.summary={archived_count:302,unarchived_count:0,episode_count:696,total_bytes:280*1024**3};
      books.ehLibraryPath='D:\\Ehentai';
      const data=[['Misc',4],['Doujinshi',143],['Manga',35],['Artist CG',80],['Western',2],['Image Set',17]];
      books.ehDashboard={total_count:281,total_bytes:6.4*1024**3,total_pages:1000,categories:data.map(([label,count],category)=>({category,label,count,bytes:1}))};
      if(mode==='empty') {media.summary={archived_count:0,unarchived_count:0,episode_count:0,total_bytes:0};books.ehDashboard={total_count:0,total_bytes:0,total_pages:0,categories:[]};}
      if(mode==='long') {
        const longPath='D:\\资料库\\'+('很长的目录名称'.repeat(20));media.mediaPath=longPath;books.ehLibraryPath=longPath;
        media.summary={archived_count:2147483647,unarchived_count:0,episode_count:2147483647,total_bytes:280*1024**4};
        books.ehDashboard.total_count=2147483647;
        books.ehDashboard.categories=Array.from({length:30},(_,category)=>({category,label:'Long category / '+('长名称'.repeat(15))+category,count:category+1,bytes:1}));
      }
      if(mode==='unbound'){media.mediaLibrary=null;books.ehLibraryPath='';}
    },mode);
    await page.waitForTimeout(300);
    assert.equal(await dialog.getByText('上次扫描',{exact:true}).count(),0);
    const count=await page.locator('.library-stats-category').count();assert.equal(count,mode==='empty'?0:5);
    if(mode==='normal') {
      assert.deepEqual(await page.locator('.library-stats-category strong').allTextContents(),['143','80','35','17','4']);
      assert.deepEqual(await page.locator('.library-stats-percentage').allTextContents(),['50.9%','28.5%','12.5%','6.0%','1.4%']);
      assert((await dialog.textContent()).includes('0.93GB'));
      assert.equal(await page.locator('.library-stats-numbers').nth(1).locator('b').last().textContent(),'6');
      assert.equal(await page.locator('.library-stats-other').getAttribute('title'),'其它 0.7%');
      await page.locator('.library-stats-other').hover();
    }
    if(mode==='empty') assert(!(await dialog.textContent()).match(/NaN|Infinity/));
    if(mode==='unbound') assert.equal(await dialog.getByText('未连接',{exact:true}).count(),2);
    const layout=await dialog.evaluate(e=>{
      const r=e.getBoundingClientRect();return {inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,
        overflow:[...e.querySelectorAll('.library-stats-card,.library-stats-category')].filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>n.className)};
    });
    assert(layout.inside);assert.deepEqual(layout.overflow,[]);
    const aligned=await page.locator('.library-stats-numbers').evaluateAll(groups=>groups.every(group=>{
      const grid=group.getBoundingClientRect();
      const numbers=[...group.querySelectorAll('.library-stats-value')].map(e=>e.getBoundingClientRect());
      const centers=numbers.map(r=>r.left+r.width/2);
      return Math.abs((centers[1]-centers[0])-(centers[2]-centers[1]))<.1&&[...group.children].every(column=>{
        const number=column.querySelector('.library-stats-value').getBoundingClientRect(),label=column.lastElementChild.getBoundingClientRect();
        return Math.abs(label.left+label.width/2-number.left-number.width/2)<.1
          &&number.left>=grid.left-.6&&number.right<=grid.right+.6&&label.left>=grid.left-.6&&label.right<=grid.right+.6;
      });
    }));
    assert(aligned,'Numeric centers must have equal spacing; labels must center on digits excluding capacity units');
    if(mode==='long') {
      await dialog.getByRole('button',{name:'刷新统计',exact:true}).scrollIntoViewIfNeeded();
      const footer=await dialog.getByRole('button',{name:'刷新统计',exact:true}).boundingBox();
      assert(footer.y>=0&&footer.y+footer.height<=height,'Long content must keep refresh reachable inside the dialog');
    }
    await page.screenshot({path:path.join(os.tmpdir(),`ero-stats-${width}-${theme}-${mode}.png`)});
    if(mode==='refresh'){
      await page.evaluate(()=>{window.__statsDelay=true;window.__statsFail=true;});
      await dialog.getByRole('button',{name:'刷新统计',exact:true}).click();
      assert(await dialog.getByRole('button',{name:'刷新中…'}).isDisabled());
      await dialog.getByRole('alert').waitFor();
      await page.waitForFunction(()=>!document.querySelector('.library-stats-content-enter-active,.library-stats-content-leave-active'));
      assert.equal(await page.locator('#metricTotalWorks').textContent(),'302');
      await page.evaluate(()=>{window.__statsFail=false;});
      await dialog.getByRole('button',{name:'刷新统计',exact:true}).click();
      await dialog.getByRole('button',{name:'刷新统计',exact:true}).waitFor();
      await page.waitForFunction(()=>!document.querySelector('.library-stats-content-enter-active,.library-stats-content-leave-active'));
      assert.equal(await dialog.getByRole('alert').count(),0);
      assert.equal(await page.locator('#metricTotalWorks').textContent(),'84');
      assert(await page.evaluate(()=>{
        const stores=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
        return !stores.get('libraryConsole').libraryMessage&&!stores.get('ehSettings').ehLibraryMessage;
      }));
      await dialog.locator('.library-stats-unarchived').click();
      await page.locator('#page-unarchived.active').waitFor();
      assert.equal(await dialog.count(),0);
    }else{
      await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);
      await page.getByRole('button',{name:'查看数据',exact:true}).click();
      await dialog.waitFor();await dialog.getByRole('button',{name:'关闭资料库数据',exact:true}).click();
      assert.equal(await dialog.count(),0);
    }
    assert.deepEqual(errors,[]);await page.close();cases++;
  }
})().catch(e=>{console.error(e);process.exit(1)});
