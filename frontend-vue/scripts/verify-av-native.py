"""AV 原生命令回归：隔离桌面/便携库；网络仅取元数据，图片使用中性缓存夹具。"""
import ctypes as c
import ctypes.wintypes as w
import json, os, pathlib, shutil, socket, sqlite3, subprocess, tempfile, time, urllib.request
from PIL import Image
from playwright.sync_api import sync_playwright

repository = pathlib.Path(__file__).resolve().parents[2]
build = repository/'src-tauri/target/path-verification/release'
case = pathlib.Path(tempfile.mkdtemp(prefix='ero-av-native-v6-'))
root = case/'ero-manager'
(root/'lib').mkdir(parents=True)
for source, target in [(build/'ero-manager.exe', root/'ero-manager.exe'),
                       (build/'ero_manager_lib.dll', root/'lib/ero_manager_lib.dll'),
                       (repository/'src-tauri/lib/libmpv-2.dll', root/'lib/libmpv-2.dll'),
                       (repository/'src-tauri/lib/libmpv-wrapper.dll', root/'lib/libmpv-wrapper.dll')]:
    shutil.copy2(source, target)
metadata = json.loads(pathlib.Path(tempfile.gettempdir(), 'ero-av-v6-live-metadata.json').read_text(encoding='utf8'))
library = case/'av-library'
folder = library/metadata['code']
(folder/'data').mkdir(parents=True)
(folder/'.av-source.json').write_text(json.dumps({'source':'javdb','code':metadata['code'],'version':1}))
assets = [('cover', metadata['cover'])]
assets += [(f'actor_{i:02}', actor['photo']) for i, actor in enumerate(metadata['actresses']) if actor['photo']]
assets += [(f'preview_{i:03}', url) for i, url in enumerate(metadata['previews'])]
manifest = {}
for i, (name, url) in enumerate(assets):
    filename = name+'.png'
    Image.new('RGB', (96,128), (65+i*7%100, 115, 190)).save(folder/'data'/filename)
    manifest[name] = url+'\n'+filename
(folder/'data/asset-sources.json').write_text(json.dumps(manifest), encoding='utf8')
other_root = case/'other-library'
other_root.mkdir()
with socket.socket() as sock:
    sock.bind(('127.0.0.1',0))
    port = sock.getsockname()[1]
user = c.WinDLL('user32',use_last_error=True)
user.CreateDesktopW.argtypes=[w.LPCWSTR,w.LPCWSTR,c.c_void_p,w.DWORD,w.DWORD,c.c_void_p]
user.CreateDesktopW.restype=w.HANDLE
user.CloseDesktop.argtypes=[w.HANDLE]
desktop_name = 'EroAvV6QA'+str(os.getpid())
desktop = user.CreateDesktopW(desktop_name,None,None,0,0x1ff,None)
assert desktop
startup = subprocess.STARTUPINFO()
startup.lpDesktop = desktop_name
startup.dwFlags = subprocess.STARTF_USESHOWWINDOW
startup.wShowWindow = 0
env = dict(os.environ, WEBVIEW2_USER_DATA_FOLDER=str(case/'webview-profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f'--remote-debugging-port={port} --remote-allow-origins=* --disable-background-timer-throttling --disable-renderer-backgrounding')
passed = []
app = None

def launch(pw):
    global app
    app = subprocess.Popen([str(root/'ero-manager.exe')],cwd=root,env=env,startupinfo=startup)
    deadline = time.monotonic()+50
    while True:
        try:
            urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version',timeout=.3).close()
            break
        except OSError:
            assert app.poll() is None, 'Fixture GUI exited'
            assert time.monotonic()<deadline, 'Fixture WebView timed out'
            time.sleep(.1)
    browser = pw.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
    page = browser.contexts[0].pages[0]
    page.wait_for_function("() => window.__TAURI_INTERNALS__ && document.getElementById('app')?.__vue_app__",timeout=30000)
    page.locator('.startup-screen').wait_for(state='hidden',timeout=40000)
    # 独立隐藏桌面没有用户操作，测试夹具关闭自动锁定边界，避免节流被误认作休眠。
    # 不改变应用默认设置或正式账号，仅影响这一个隔离库。
    page.evaluate("() => { const s=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('accounts');Object.assign(s.privacy,{system:false,minimize:false,idle_seconds:0,background_seconds:0}); }")
    return browser, page

def call(page, command, **args):
    return page.evaluate("async ({command,args}) => Promise.race([window.__TAURI_INTERNALS__.invoke(command,args),new Promise((_,reject)=>setTimeout(()=>reject(new Error('IPC timeout: '+command)),120000))])", {'command':command,'args':args})

def rejected(page, command, **args):
    try:
        call(page,command,**args)
    except Exception:
        return
    raise AssertionError(command+' unexpectedly succeeded')

def close(page):
    try:
        call(page,'apply_close_action',action='exit')
    except Exception:
        pass
    app.wait(timeout=15)

try:
    with sync_playwright() as pw:
        browser,page = launch(pw)
        state = call(page,'account_state')
        scope = state['scope']
        assert scope and state['current']['id']=='0001'
        assert call(page,'get_application_info')['version']=='6.0.0'
        rejected(page,'av_bind_root',scope=scope,rootPath=str(root))
        rejected(page,'av_fetch_work',scope=scope,code='../TEST-100',queuedAt=1)
        call(page,'av_bind_root',scope=scope,rootPath=str(library))
        assert call(page,'av_list_works',scope=scope)==[]
        old_backup = case/'pre-av-unified.db'
        call(page,'backup_database',backupPath=str(old_backup))
        with sqlite3.connect(old_backup) as conn:
            conn.execute('DROP TABLE AvWorks')
        passed.append('native v6 startup; existing selected root required; app-directory/traversal rejection')
        # 实际 IPC/网络元数据与存储命令；manifest 让图像均命中中性缓存，不请求作品图片。
        page.evaluate("({scope,code}) => { window.avQA = window.__TAURI_INTERNALS__.invoke('av_fetch_work',{scope,code,queuedAt:Date.now()}).then(value=>({value}),error=>({error:String(error)})); }", {'scope':scope,'code':metadata['code']})
        time.sleep(.8)
        started = time.monotonic()
        assert call(page,'get_application_info')['version']=='6.0.0'
        assert time.monotonic()-started < 2, 'Network fetch blocked unrelated IPC'
        reply = page.evaluate('() => window.avQA')
        assert 'error' not in reply, reply.get('error')
        result = reply['value']
        work = result['work']
        assert not result['warnings'], result['warnings']
        assert work['code']==metadata['code'] and work['title']==metadata['title']
        for field in ['release_date','duration_minutes','studio','series','tags']:
            assert work[field]==metadata[field], field
        assert len(work['previews'])==len(metadata['previews'])
        for asset in [work['cover']]+work['previews']+[a['photo'] for a in work['actresses'] if a['photo']]:
            assert pathlib.Path(asset).resolve().is_relative_to(folder.resolve()) and pathlib.Path(asset).is_file()
        magnet = 'magnet:?xt=urn:btih:0123456789012345678901234567890123456789'
        saved = call(page,'av_add_magnet',scope=scope,code=work['code'],magnet=magnet)
        call(page,'av_add_magnet',scope=scope,code=work['code'],magnet=magnet)
        disk = json.loads((folder/'data/meta.json').read_text(encoding='utf8'))
        assert disk['magnets']==[magnet] and list(disk)[-1]=='magnets'
        assert not pathlib.PureWindowsPath(disk['cover']).is_absolute() and not disk['folder_path']
        assert len(call(page,'av_list_works',scope=scope))==1
        passed.append('live metadata through native IPC; original language/fields; neutral cached images; responsive concurrent IPC; relative JSON; appended/deduplicated magnets')
        close(page)
        time.sleep(.5)
        browser,page = launch(pw)
        scope = call(page,'account_state')['scope']
        assert scope
        persisted = call(page,'av_list_works',scope=scope)
        assert len(persisted)==1 and persisted[0]['magnets']==[magnet]
        call(page,'av_bind_root',scope=scope,rootPath=str(other_root))
        assert not call(page,'av_list_works',scope=scope)
        call(page,'av_bind_root',scope=scope,rootPath=str(library))
        assert len(call(page,'av_list_works',scope=scope))==1
        passed.append('restart persistence; root switching hides other indexes; owned JSON re-admission without rewriting images/magnets')
        page.evaluate("({scope,code}) => { window.avQA = window.__TAURI_INTERNALS__.invoke('av_fetch_work',{scope,code,queuedAt:Date.now()}).then(value=>({value}),error=>({error:String(error)})); }", {'scope':scope,'code':metadata['code']})
        time.sleep(.8)
        call(page,'restore_database',restorePath=str(old_backup))
        reply = page.evaluate('() => window.avQA')
        assert 'error' in reply and '恢复' in reply['error'], 'Old fetch repopulated restored index'
        rejected(page,'av_list_works',scope=scope)
        scope = call(page,'account_auth',id='0001',pin='')['scope']
        assert not call(page,'av_list_works',scope=scope)
        call(page,'av_bind_root',scope=scope,rootPath=str(library))
        assert call(page,'av_list_works',scope=scope)[0]['magnets']==[magnet]
        with sqlite3.connect(root/'db/database.db') as conn:
            assert conn.execute('PRAGMA quick_check').fetchone()[0]=='ok'
            assert conn.execute('SELECT COUNT(*) FROM AvWorks').fetchone()[0]==1
        assert not list((root/'db').glob('eh-database.db*')) and not list((root/'db').rglob('*.lock'))
        passed.append('pre-AV unified backup restore; in-flight fetch invalidation; revoked scope; JSON recovery; single intact database')
        report = {'status':'PASS','checks':passed,'root':str(root),'image_test_boundary':'real ordinary portrait HTTP was checked separately; native workflow uses neutral cached cover/preview fixtures'}
        (case/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps(report,ensure_ascii=False))
        close(page)
finally:
    # 失败时也只处理本脚本创建的隔离进程，绝不接触正式 GUI 或用户桌面。
    if app and app.poll() is None:
        app.terminate()
        app.wait(timeout=15)
    user.CloseDesktop(desktop)
