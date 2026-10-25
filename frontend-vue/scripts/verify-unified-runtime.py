"""独立 Windows 桌面的真实 Tauri 单库回归；仅使用 verify-accounts-native 的临时夹具。"""
import ctypes as c, ctypes.wintypes as w, json, os, pathlib, socket, sqlite3, struct, subprocess, tempfile, time, urllib.request, zipfile, zlib
from PIL import Image
from playwright.sync_api import sync_playwright

root=pathlib.Path(tempfile.gettempdir(),'ero-accounts-native-path.txt').read_text(encoding='utf-8')
root=pathlib.Path(root)
assert root.resolve().is_relative_to(pathlib.Path(tempfile.gettempdir()).resolve())
assert root.parent.name.startswith('ero-accounts-native-')
media=root/'media';books=root/'books';media.mkdir();books.mkdir()
(media/'.hanime-library.json').write_text(json.dumps({'version':1,'library_id':'unified-qa'}))
work=media/'work';(work/'data').mkdir(parents=True)
Image.new('RGB',(48,72),'blue').save(work/'data/cover.png')
(work/'01.mp4').write_bytes(b'fixture')
(work/'data/meta.json').write_text(json.dumps({'title':'Fixture media','episode_list':[{'id':1,'release_date':'2020-01-01'}]}))
db=sqlite3.connect(root/'db/database.db')
db.execute("INSERT INTO Works(Title,Year,Month,CoverPath,FolderPath) VALUES('Fixture media',2020,1,?,?)",(str(work/'data/cover.png'),str(work)))
work_id=db.execute('SELECT last_insert_rowid()').fetchone()[0]
db.execute('INSERT INTO Episodes(WorkId,Number,VideoPath,CoverPath) VALUES(?,1,?,?)',(work_id,str(work/'01.mp4'),str(work/'data/cover.png')))
for key,value in [('media_library_id','unified-qa'),('media_library_root',str(media)),('media_library_relative','media')]:
    db.execute('INSERT OR REPLACE INTO AppSettings VALUES(?,?)',(key,value))
for gid,source,category in [(123,'eh',2),(-123,'hitomi',4)]:
    folder=books/source;(folder/'data').mkdir(parents=True)
    for name in ['000001.png','000002.png','data/cover.png']: Image.new('RGB',(48,72),'green').save(folder/name)
    meta={'gid':123,'token':'fixture','source':source,'source_id':'123','title':source+' fixture','category':category,'artist':['artist'],'group':[],'tags':['sample'],'pages':2,'posted':'2020-01-01','language':'japanese'}
    if source=='hitomi': meta.update(source_category='manga',source_tags=['female:sample'],series=[],characters=[],image_format='webp')
    (folder/'data/meta.json').write_text(json.dumps(meta))
    if source=='hitomi': (folder/'data/hitomi-source.json').write_text(json.dumps({'source':'hitomi','source_id':'123'}))
    db.execute("INSERT INTO EhGalleries(Gid,Token,Title,Category,ArtistJson,GroupJson,TagsJson,Pages,Posted,CoverPath,FolderPath,Source,SourceId,Language,TotalBytes,AddedAt) VALUES(?,?,?,?,'[\"artist\"]','[]','[\"sample\"]',2,'2020-01-01',?,?,?,'123','japanese',NULL,'2000-01-01')",(gid,'fixture' if gid>0 else '',source+' fixture',category,str(folder/'data/cover.png'),str(folder),source))
db.execute("INSERT OR REPLACE INTO EhSettings VALUES('root_path',?)",(str(books),));db.commit();db.close()
with socket.socket() as sock: sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
user=c.WinDLL('user32',use_last_error=True)
user.CreateDesktopW.argtypes=[w.LPCWSTR,w.LPCWSTR,c.c_void_p,w.DWORD,w.DWORD,c.c_void_p];user.CreateDesktopW.restype=w.HANDLE
user.CloseDesktop.argtypes=[w.HANDLE]
desktop_name='EroUnifiedQA'+str(os.getpid());desktop=user.CreateDesktopW(desktop_name,None,None,0,0x1ff,None);assert desktop
startup=subprocess.STARTUPINFO();startup.lpDesktop=desktop_name;startup.dwFlags=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=0
env=dict(os.environ,WEBVIEW2_USER_DATA_FOLDER=str(root/'webview-profile'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f'--remote-debugging-port={port} --remote-allow-origins=*')
app=subprocess.Popen([str(root/'ero-manager.exe')],cwd=root,env=env,startupinfo=startup)
admin=None;passed=[]
def note(text): passed.append(text)
def pipe(action,pin='2468'):
    name=r'\\.\pipe\ero-manager-admin-'+format(zlib.crc32(str(root).lower().encode())&0xffffffff,'08x')
    payload=json.dumps({'pin':pin,'action':action}).encode()
    for attempt in range(30):
        try: channel=open(name,'r+b',buffering=0);break
        except OSError: time.sleep(.1)
    else: raise AssertionError('Admin service pipe did not open')
    with channel:
        channel.write(struct.pack('<I',len(payload))+payload)
        size=struct.unpack('<I',channel.read(4))[0];data=b''
        while len(data)<size: data+=channel.read(size-len(data))
    reply=json.loads(data);assert not reply.get('error'),reply.get('error')
    return reply
try:
    until=time.monotonic()+40
    while True:
        try:
            urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version',timeout=.3).close();break
        except OSError:
            assert app.poll() is None,'Isolated GUI exited'
            assert time.monotonic()<until,'WebView endpoint timeout'
            time.sleep(.1)
    with sync_playwright() as pw:
        browser=pw.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
        page=browser.contexts[0].pages[0]
        page.wait_for_function("() => window.__TAURI_INTERNALS__ && document.getElementById('app')?.__vue_app__",timeout=30000)
        page.locator('.startup-screen').wait_for(state='hidden',timeout=40000)
        def call(command,**args):
            return page.evaluate("async ({command,args}) => Promise.race([window.__TAURI_INTERNALS__.invoke(command,args),new Promise((_,reject)=>setTimeout(()=>reject(new Error('IPC timeout: '+command)),15000))])",{'command':command,'args':args})
        def rejected(command,**args):
            try: call(command,**args)
            except Exception: return
            raise AssertionError(command+' unexpectedly succeeded')
        state=call('account_state');scope=state['scope'];assert scope and state['current']['id']=='0001'
        assert len(call('get_all_works_with_tags'))==1
        assert len(call('get_work_detail',workId=work_id)['episodes'])==1
        assert {g['gid'] for g in call('eh_list_local_galleries')}=={123,-123}
        assert pathlib.Path(call('eh_get_library_overview')['database_path']).resolve()==(root/'db/database.db').resolve()
        for gid in [123,-123]: assert len(call('eh_get_gallery_pages',gid=gid))==2
        note('native startup; media list/detail; book list/detail/pages; single database path')
        scan=call('eh_scan_local_library',rootPath=str(books));assert scan['indexed']==2 and not scan['errors'],scan
        with sqlite3.connect(root/'db/database.db') as conn: assert conn.execute("SELECT COUNT(*) FROM EhGalleries WHERE AddedAt='2000-01-01'").fetchone()[0]==2
        dash=call('eh_get_library_dashboard');assert dash['total_count']==2 and dash['total_bytes']>0
        call('get_library_console_summary',rootPath=str(media))
        note('scan/relist; Eh/Hitomi same-number identity; admission time; cached statistics')
        for gid in [123,-123]: call('eh_set_gallery_favorite',scope=scope,gid=gid,favorite=True)
        assert set(call('eh_get_favorite_galleries',scope=scope))=={123,-123}
        filters=page.evaluate("""async () => {
          const s=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ehLibrary');
          await s.load(); if(s.error) throw Error(s.error);
          s.search='123'; const id=s.filteredGalleries.length;
          s.search='sample'; const tag=s.filteredGalleries.length;
          s.search=''; s.activeFilters={category:['4']}; const category=s.filteredGalleries.map(g=>g.gid);
          s.activeFilters={};s.favoriteMode=true;const favorite=s.filteredGalleries.length;
          s.favoriteMode=false;s.search='';s.currentSort='added-desc';
          return {id,tag,category,favorite};
        }""")
        assert filters=={'id':2,'tag':2,'category':[-123],'favorite':2},filters
        record={'kind':'book','content_id':-123,'position':1,'pair_offset':1,'merged_pairs':[]}
        call('set_work_record',scope=scope,record=record)
        assert call('get_work_record',scope=scope,kind='book',contentId=-123)['position']==1
        call('set_work_record',scope=scope,record=dict(record,kind='media',content_id=work_id,position=12.5))
        assert call('get_work_record',scope=scope,kind='media',contentId=work_id)['position']==12.5
        prefs=call('get_user_preferences',scope=scope);prefs['player_volume']=42
        call('set_user_preferences',scope=scope,preferences=prefs)
        call('account_set_data',scope=scope,kind='draw',item='media',value='{"seen":[1],"recent":[1]}')
        assert call('account_get_data',scope=scope,kind='draw',item='media')
        results=page.evaluate("async scope => Promise.all(Array.from({length:36},(_,i)=>window.__TAURI_INTERNALS__.invoke(i%3===0?'eh_list_local_galleries':i%3===1?'eh_get_library_dashboard':'get_user_preferences',i%3===2?{scope}:{})))",scope)
        assert len(results)==36
        note('ID/tag/category/favorite filters; signed favorites; media/book progress; preferences; draw history; 36 concurrent requests')
        users=pipe({'type':'authenticate'})['users'];assert len([u for u in users if u['id']!='0000'])==1
        admin=subprocess.Popen([str(root/'ero-manager-admin.exe')],cwd=root,startupinfo=startup,creationflags=subprocess.CREATE_NEW_CONSOLE)
        time.sleep(.7);assert admin.poll() is None
        duplicate=subprocess.Popen([str(root/'ero-manager-admin.exe')],cwd=root,startupinfo=startup,creationflags=subprocess.CREATE_NEW_CONSOLE)
        assert duplicate.wait(timeout=8)==2 and admin.poll() is None
        assert call('eh_get_library_overview')['total_count']==2
        admin.kill();admin.wait(timeout=8);admin=None
        second=pipe({'type':'create','nickname':'isolated second','pin':'','copy':''})['users']
        user2=next(u for u in second if u['id'] not in ['0000','0001'])
        other=call('account_auth',id=user2['id'],pin='');other_scope=other['scope']
        assert not call('eh_get_favorite_galleries',scope=other_scope)
        call('eh_set_gallery_favorite',scope=other_scope,gid=123,favorite=True)
        pipe({'type':'reset_pin','key':user2['key'],'pin':'1357'})
        rejected('account_set_data',scope=other_scope,kind='draw',item='media',value='stale')
        call('account_auth',id=user2['id'],pin='1357')
        scope=call('account_auth',id='0001',pin='')['scope']
        assert call('get_user_preferences',scope=scope)['player_volume']==42
        note('GUI/TUI simultaneous; duplicate TUI rejected; account isolation; PIN reset revokes old scope')
        exports=root.parent/'backup/ero-manager backup';full=exports/'runtime-full.db';package=exports/'runtime-full.zip'
        call('backup_database',backupPath=str(full));call('backup_data_package',backupPath=str(package))
        with zipfile.ZipFile(package) as archive:
            payload=exports/'exported-snapshot.db';payload.write_bytes(archive.read('_hanime_manager/database.db'))
        with sqlite3.connect(payload) as exported:
            assert exported.execute('SELECT COUNT(*) FROM EhGalleries').fetchone()[0]==2
            assert exported.execute('SELECT COUNT(*) FROM Accounts').fetchone()[0]==3
            assert exported.execute('PRAGMA quick_check').fetchone()[0]=='ok'
        note('database backup and ZIP snapshot contain books, accounts and media together')
        invalid=exports/'invalid.db';invalid.write_text('not a sqlite database')
        rejected('restore_database',restorePath=str(invalid))
        rejected('restore_database',restorePath=str(root/'db/database.db'))
        assert call('account_state')['scope']==scope
        call('eh_delete_gallery_record',gid=123)
        with sqlite3.connect(root/'db/database.db') as conn: assert conn.execute("SELECT COUNT(*) FROM AccountValues WHERE Kind='favorite-book' AND Item='123'").fetchone()[0]==0
        racing=dict(prefs,player_volume=99)
        race=page.evaluate("async ({path,scope,preferences}) => Promise.allSettled([window.__TAURI_INTERNALS__.invoke('restore_database',{restorePath:path}),...Array.from({length:24},()=>window.__TAURI_INTERNALS__.invoke('set_user_preferences',{scope,preferences}))])",{'path':str(full),'scope':scope,'preferences':racing})
        assert race[0]['status']=='fulfilled',race[0]
        restored=call('account_state');assert restored['locked'] and not restored['scope']
        rejected('get_work_record',scope=scope,kind='book',contentId=-123)
        scope=call('account_auth',id='0001',pin='')['scope']
        assert set(call('eh_get_favorite_galleries',scope=scope))=={123,-123}
        assert call('get_work_record',scope=scope,kind='book',contentId=-123)['position']==1
        assert len(call('eh_list_local_galleries'))==2
        assert call('get_user_preferences',scope=scope)['player_volume']==42
        note('invalid/self restore rejected; live WAL-safe restore; 24 racing stale writes rejected or precede restore; session revocation; favorites/progress restored')
        call('hitomi_delete_gallery_folder',id=123)
        assert not (books/'hitomi').exists() and (books/'eh').exists()
        assert {g['gid'] for g in call('eh_list_local_galleries')}=={123}
        call('eh_delete_gallery_record',gid=123)
        assert not call('eh_get_favorite_galleries',scope=scope)
        assert len(call('get_all_works_with_tags'))==1
        note('Hitomi bounded deletion; record-only deletion; all-account favorite cleanup; media unaffected')
        assert not list((root/'db').glob('eh-database.db*')) and not list((root/'db').rglob('*.lock'))
        report={'status':'PASS','checks':passed,'root':str(root)}
        (root/'unified-runtime-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(report,ensure_ascii=False))
finally:
    # 仅终止本脚本在独立桌面创建的夹具；不关闭用户桌面及正式进程。
    if admin and admin.poll() is None: admin.kill();admin.wait(timeout=8)
    if app.poll() is None: app.kill();app.wait(timeout=8)
    user.CloseDesktop(desktop)
