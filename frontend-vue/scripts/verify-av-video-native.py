"""AV 视频原生回归：独立桌面/便携库，真实解码生成的中性 WMV/MP4，不访问外部站点。"""
import ctypes as c
import ctypes.wintypes as w
import json, os, pathlib, shutil, socket, sqlite3, subprocess, tempfile, time, urllib.request
from PIL import Image
from playwright.sync_api import sync_playwright

repository = pathlib.Path(__file__).resolve().parents[2]
build = repository/'src-tauri/target/path-verification/release'
case = pathlib.Path(tempfile.mkdtemp(prefix='ero-av-video-native-'))
root = case/'ero-manager'
(root/'lib').mkdir(parents=True)
for source, target in [(build/'ero-manager.exe', root/'ero-manager.exe'),
                       (build/'ero_manager_lib.dll', root/'lib/ero_manager_lib.dll'),
                       (repository/'src-tauri/lib/libmpv-2.dll', root/'lib/libmpv-2.dll'),
                       (repository/'src-tauri/lib/libmpv-wrapper.dll', root/'lib/libmpv-wrapper.dll')]:
    shutil.copy2(source, target)
library = case/'av-library'
for code in ['IPX-607','TEST-102']:
    folder = library/code
    (folder/'data').mkdir(parents=True)
    (folder/'.av-source.json').write_text(json.dumps({'source':'javdb','code':code,'version':1}))
    Image.new('RGB',(480,320),'steelblue').save(folder/'data/cover.png')
    (folder/'data/meta.json').write_text(json.dumps({'code':code,'title':'中性视频核验','cover':'data/cover.png','cover_layout':'jacket','release_date':'2026-01-01','studio':'Fixture','magnets':[]},ensure_ascii=False),encoding='utf8')
folder = library/'IPX-607'
original = folder/'ipx 607.WMV'
cut = folder/'IPX-607~cut.mp4'
ffmpeg = shutil.which('ffmpeg') or r'D:/Envirnment/ffmpeg/bin/ffmpeg.exe'
for target,codec,duration in [(original,'wmv2',18),(cut,'mpeg4',10)]:
    subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=24','-t',str(duration),'-an','-c:v',codec,'-y',str(target)],check=True,timeout=60,creationflags=subprocess.CREATE_NO_WINDOW)
with socket.socket() as sock:
    sock.bind(('127.0.0.1',0))
    port = sock.getsockname()[1]
user = c.WinDLL('user32',use_last_error=True)
user.CreateDesktopW.argtypes=[w.LPCWSTR,w.LPCWSTR,c.c_void_p,w.DWORD,w.DWORD,c.c_void_p]
user.CreateDesktopW.restype=w.HANDLE
user.CloseDesktop.argtypes=[w.HANDLE]
desktop_name = 'EroAvVideoQA'+str(os.getpid())
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
        scope = call(page,'account_state')['scope']
        assert scope
        call(page,'av_bind_root',scope=scope,rootPath=str(library))
        works = call(page,'av_list_works',scope=scope)
        assert [v['kind'] for v in next(w for w in works if w['code']=='IPX-607')['videos']]==['original','cut']
        assert not next(w for w in works if w['code']=='TEST-102')['videos']
        call(page,'account_set_data',scope=scope,kind='av-playback',item='IPX-607:original',value='{"position":2}')
        page.get_by_role('button',name='AV',exact=True).click()
        page.locator('[data-code="IPX-607"]').click()
        page.locator('.home-detail-flight').wait_for(state='detached')
        assert page.locator('.av-video-panel .episode-num').all_text_contents()==['原版','剪辑版']
        page.evaluate("async()=>{const p=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('preferences');p.update({remember_playback:true,player_loop:'off',player_auto_next:false});await p.flush();}")
        page.locator('.av-video-panel [data-video-kind="original"]').click()
        page.wait_for_function("()=>{const p=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player');return p.nativeVisible&&!p.videoLoading&&p.currentTime>=2;}",timeout=25000)
        def prop(name,fmt='string'):
            return call(page,'plugin:libmpv|get_property',name=name,format=fmt,windowLabel='main')
        assert str(prop('path')).lower().endswith('ipx 607.wmv')
        assert prop('duration','double')>17 and prop('width','double')==640
        t=prop('time-pos','double'); time.sleep(.4); assert prop('time-pos','double')>t
        passed.append('real libmpv decoded WMV synthetic original with first-frame reveal and AV resume')
        page.locator('#playerTimeInput').fill('00:04')
        page.locator('#playerTimeInput').press('Enter')
        page.get_by_role('button',name='全屏',exact=True).click()
        page.wait_for_function("()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player').fullscreen")
        assert page.evaluate("()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player').fullscreen")
        page.keyboard.press('Escape')
        page.wait_for_function("()=>!document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player').fullscreen")
        page.locator('.player-other-item').nth(1).click()
        page.wait_for_function("()=>{const p=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player');return p.episode?.id===2&&p.nativeVisible&&!p.videoLoading;}",timeout=25000)
        assert str(prop('path')).lower().endswith('ipx-607~cut.mp4')
        assert prop('duration','double')>9 and prop('width','double')==640
        page.locator('#playerTimeInput').fill('00:03')
        page.locator('#playerTimeInput').press('Enter')
        page.locator('#page-player .player-back-slot button').click()
        page.locator('#page-detail').wait_for(state='visible')
        positions=[json.loads(call(page,'account_get_data',scope=scope,kind='av-playback',item='IPX-607:'+kind))['position'] for kind in ['original','cut']]
        assert positions[0]>=4 and positions[1]>=3, positions
        assert not page.evaluate("()=>document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player').nativeVisible")
        passed.append('real MP4 cut decode, manual variant switching, fullscreen/restore, distinct account-scoped progress and detail return')
        renamed=folder/'IPX607.avi'
        original.rename(case/'held-original.wmv')
        subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=24','-t','18','-an','-c:v','mpeg4','-y',str(renamed)],check=True,timeout=60,creationflags=subprocess.CREATE_NO_WINDOW)
        assert call(page,'av_get_local_videos',scope=scope,code='IPX-607')[0]['file_name']=='IPX607.avi'
        page.locator('.av-video-panel [data-video-kind="original"]').click()
        page.wait_for_function("()=>{const p=document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player');return p.episode?.id===1&&p.nativeVisible&&!p.videoLoading;}",timeout=25000)
        assert str(prop('path')).lower().endswith('ipx607.avi') and prop('width','double')==640
        assert prop('time-pos','double')>=4, 'AVI resume was discarded before duration became available'
        page.locator('#page-player .player-back-slot button').click()
        page.locator('#page-detail').wait_for(state='visible')
        passed.append('real AVI container decode after replacing the original; play rechecks current local filename')
        for current,name in [(renamed,'held-original.avi'),(cut,'held-cut.mp4')]:
            target=case/name
            assert current.resolve().is_relative_to(case.resolve()) and target.resolve().is_relative_to(case.resolve())
            current.rename(target)
        assert not call(page,'av_get_local_videos',scope=scope,code='IPX-607')
        page.get_by_role('button',name='返回',exact=True).click()
        page.locator('.home-detail-flight').wait_for(state='detached')
        page.wait_for_function("()=>document.querySelectorAll('.av-no-video').length===2")
        assert 'videos' not in json.loads((folder/'data/meta.json').read_text(encoding='utf8'))
        call(page,'account_lock')
        rejected(page,'av_get_local_videos',scope=scope,code='IPX-607')
        scope=call(page,'account_auth',id='0001',pin='')['scope']
        assert json.loads(call(page,'account_get_data',scope=scope,kind='av-playback',item='IPX-607:original'))['position']>=4
        passed.append('AVI filename recognition, local removal reflected by no-video badge, derived video list absent from source JSON, stale-scope rejection and retained progress')
        report={'status':'PASS','checks':passed,'root':str(root),'boundary':'isolated hidden Windows desktop; neutral generated videos; real native decoding properties checked, no production media/accounts used'}
        (case/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps(report,ensure_ascii=False))
        close(page)
finally:
    if app and app.poll() is None:
        app.terminate();app.wait(timeout=15)
    user.CloseDesktop(desktop)
