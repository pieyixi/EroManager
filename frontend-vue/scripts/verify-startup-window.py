"""真实开屏窗口负载验证：独立便携库/Windows桌面，不切换或操作用户桌面。"""
import argparse
import ctypes as c
import ctypes.wintypes as w
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.request
from urllib.parse import unquote
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('build', type=Path)
parser.add_argument('--expect-blocked', action='store_true')
args = parser.parse_args()
root = Path(tempfile.mkdtemp(prefix='ero-startup-window-'))
for folder in ['db', 'media', 'lib']:
    (root / folder).mkdir()
for name in ['ero-manager.exe', 'lib/ero_manager_lib.dll', 'lib/libmpv-2.dll', 'lib/libmpv-wrapper.dll']:
    source = args.build / name
    if not source.exists() and name == 'lib/ero_manager_lib.dll':
        source = args.build / 'ero_manager_lib.dll'
        if not source.exists():
            source = args.build / 'deps/ero_manager_lib.dll'
    shutil.copy2(source, root / name)
(root / 'media/.hanime-library.json').write_text(json.dumps({'version': 1, 'library_id': 'startup-window-qa'}))
db = sqlite3.connect(root / 'db/database.db')
db.executescript('CREATE TABLE AppSettings(Key TEXT PRIMARY KEY,Value TEXT);')
db.executemany('INSERT INTO AppSettings VALUES(?,?)', [
    ('media_library_id', 'startup-window-qa'), ('media_library_root', str(root / 'media')),
    ('media_library_relative', 'media'),
])
db.commit()
db.close()
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]

u = c.WinDLL('user32', use_last_error=True)
u.CreateDesktopW.argtypes = [w.LPCWSTR, w.LPCWSTR, c.c_void_p, w.DWORD, w.DWORD, c.c_void_p]
u.CreateDesktopW.restype = w.HANDLE
u.CloseDesktop.argtypes = [w.HANDLE]
u.GetForegroundWindow.restype = w.HWND
u.GetWindowThreadProcessId.argtypes = [w.HWND, c.POINTER(w.DWORD)]
u.GetWindowTextW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
u.IsZoomed.argtypes = [w.HWND]
u.IsIconic.argtypes = [w.HWND]
u.PostMessageW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
u.SendMessageTimeoutW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM, w.UINT, w.UINT, c.POINTER(c.c_size_t)]
u.SendMessageTimeoutW.restype = w.LPARAM
u.SetWindowPos.argtypes = [w.HWND, w.HWND, c.c_int, c.c_int, c.c_int, c.c_int, w.UINT]
class Rect(c.Structure):
    _fields_ = [('left', c.c_long), ('top', c.c_long), ('right', c.c_long), ('bottom', c.c_long)]
u.GetWindowRect.argtypes = [w.HWND, c.POINTER(Rect)]
Callback = c.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
u.EnumDesktopWindows.argtypes = [w.HANDLE, Callback, w.LPARAM]
u.EnumThreadWindows.argtypes = [w.DWORD, Callback, w.LPARAM]

def wait(check, timeout=2):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        if check():
            return
        time.sleep(.03)
    raise AssertionError('Window did not respond within deadline')

def bounds(hwnd):
    r = Rect()
    assert u.GetWindowRect(hwnd, c.byref(r))
    return [r.left, r.top, r.right, r.bottom]

desktop_name = f'EroStartupQA{os.getpid()}'
desktop = u.CreateDesktopW(desktop_name, None, None, 0, 0x1ff, None)
assert desktop
foreground = u.GetForegroundWindow()
startup = subprocess.STARTUPINFO()
startup.lpDesktop = desktop_name
startup.dwFlags = subprocess.STARTF_USESHOWWINDOW
startup.wShowWindow = 0
environment = dict(os.environ)
environment['WEBVIEW2_USER_DATA_FOLDER'] = str(root / 'webview-profile')
environment['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = f'--remote-debugging-port={port} --remote-allow-origins=*'
app = subprocess.Popen([str(root / 'ero-manager.exe')], cwd=root, env=environment, startupinfo=startup)
report = {'root': str(root), 'baseline': args.expect_blocked}
try:
    def endpoint():
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version', timeout=.3):
                return True
        except OSError:
            assert app.poll() is None, 'Isolated app exited'
            return False
    wait(endpoint, 20)
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
        page = browser.contexts[0].pages[0]
        page.set_default_timeout(2500)
        # CDP首次握手可能晚于冷启动；重载同一原生窗口，确保覆盖完整启动查询区间。
        page.wait_for_function("() => document.getElementById('app')?.__vue_app__", timeout=30000)
        page.locator('.startup-screen').wait_for(state='hidden', timeout=30000)
        page.wait_for_function("() => document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('libraryConsole').mediaLibrary", timeout=30000)
        # 首次空库迁移完成后才安装负载，避免首次建库或30秒回退混入被测区间。
        # 真正占用启动SQL及共享Mutex，不在组件加假等待，不修改正式数据库。
        with sqlite3.connect(root / 'db/database.db') as db:
            db.executescript('''CREATE TRIGGER SlowStartup BEFORE UPDATE OF Value ON AppSettings
            WHEN NEW.Key='media_library_id' BEGIN
              SELECT count(*) FROM (
                WITH RECURSIVE Slow(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM Slow WHERE x<12000000)
                SELECT x FROM Slow
              );
            END;''')
        page.reload(wait_until='domcontentloaded')
        page.locator('.startup-screen').wait_for(state='visible')
        # 等待同步启动链真正拿到原生DB锁，不能仅用前端假延迟冒充本次故障。
        page.wait_for_function("""() => {
          const s=document.getElementById('app')?.__vue_app__?.config.globalProperties.$pinia._s;
          return s?.get('preferences')?.loaded && !s?.get('libraryConsole')?.mediaLibrary;
        }""")
        time.sleep(.2)
        windows = []
        @Callback
        def found(hwnd, _):
            pid = w.DWORD()
            u.GetWindowThreadProcessId(hwnd, c.byref(pid))
            if pid.value == app.pid:
                r = bounds(hwnd)
                title = c.create_unicode_buffer(256)
                u.GetWindowTextW(hwnd, title, 256)
                if title.value == '裏界箱庭' and r[2] - r[0] > 500 and r[3] - r[1] > 400:
                    windows.append(hwnd)
            return True
        enumerated = bool(u.EnumDesktopWindows(desktop, found, 0))
        if not enumerated:
            # 某些WebView宿主限制独立桌面的枚举，直接按测试进程线程枚举其窗口。
            kernel = c.WinDLL('kernel32', use_last_error=True)
            class ThreadEntry(c.Structure):
                _fields_ = [(name, w.DWORD) for name in ['size', 'usage', 'tid', 'pid', 'base', 'delta', 'flags']]
            kernel.CreateToolhelp32Snapshot.argtypes = [w.DWORD, w.DWORD]
            kernel.CreateToolhelp32Snapshot.restype = w.HANDLE
            kernel.Thread32First.argtypes = [w.HANDLE, c.POINTER(ThreadEntry)]
            kernel.Thread32Next.argtypes = [w.HANDLE, c.POINTER(ThreadEntry)]
            kernel.CloseHandle.argtypes = [w.HANDLE]
            snapshot = kernel.CreateToolhelp32Snapshot(4, 0)
            try:
                entry = ThreadEntry()
                entry.size = c.sizeof(entry)
                more = kernel.Thread32First(snapshot, c.byref(entry))
                while more:
                    if entry.pid == app.pid:
                        u.EnumThreadWindows(entry.tid, found, 0)
                    more = kernel.Thread32Next(snapshot, c.byref(entry))
            finally:
                kernel.CloseHandle(snapshot)
        assert windows, 'App window missing on isolated desktop'
        hwnd = windows[0]
        native_result = c.c_size_t()
        before = time.monotonic()
        responds = bool(u.SendMessageTimeoutW(hwnd, 0, 0, 0, 2, 300, c.byref(native_result)))
        report.update(nativeResponds=responds, messageMs=round((time.monotonic()-before)*1000, 1))
        if args.expect_blocked:
            assert not responds, 'Original build did not reproduce the native message stall'
            report['status'] = 'PASS: original native startup stall reproduced'
        else:
            assert responds, 'Background SQL still blocks the native UI message loop'
            splash = page.locator('.startup-screen')
            assert splash.is_visible()
            page.screenshot(path=str(root / 'startup-before.png'))
            requests = []
            page.on('request', lambda request: requests.append(unquote(request.url)))
            page.locator('.startup-chrome').get_by_role('button', name='最大化', exact=True).click()
            try:
                wait(lambda: u.IsZoomed(hwnd))
            except AssertionError:
                report['diagnostic'] = page.evaluate("""() => ({
                  windowApi:!!window.__TAURI__?.window?.getCurrentWindow,
                  button:document.querySelector('.startup-chrome .maximize')?.outerHTML,
                  viewport:[innerWidth,innerHeight]})""")
                report['hwnds'] = [int(item) for item in windows]
                (root/'failed.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
                print(json.dumps(report,ensure_ascii=False), flush=True)
                raise
            assert splash.is_visible(), 'Maximize check ran after startup finished'
            page.locator('.startup-chrome').get_by_role('button', name='还原', exact=True).click()
            wait(lambda: not u.IsZoomed(hwnd))
            # 双击空白只由Tauri处理一次，不再被Vue重复切回。
            page.mouse.dblclick(320, 330)
            wait(lambda: u.IsZoomed(hwnd))
            page.wait_for_timeout(180)
            assert u.IsZoomed(hwnd), 'Double click toggled maximize twice'
            page.locator('.startup-chrome').get_by_role('button', name='还原', exact=True).click()
            wait(lambda: not u.IsZoomed(hwnd))
            # CDP鼠标不按下系统物理鼠标键；验证真实拖动IPC及时获原生确认，
            # 再用跨线程窗口消息核验实际移动/缩放，避免操作用户输入桌面。
            page.mouse.move(320, 330)
            with page.expect_response(lambda response: 'plugin:window|start_dragging' in unquote(response.url), timeout=1500) as drag:
                page.mouse.down()
            assert drag.value.headers.get('tauri-response') == 'ok', drag.value.headers
            page.mouse.up()
            before_rect = bounds(hwnd)
            assert u.SetWindowPos(hwnd, None, before_rect[0]+35, before_rect[1]+25, 1120, 740, 0x4014)
            wait(lambda: bounds(hwnd)[0] == before_rect[0]+35 and bounds(hwnd)[2]-bounds(hwnd)[0] == 1120)
            assert splash.is_visible(), 'Move/resize check ran after loading'
            after_rect = bounds(hwnd)
            edge = (after_rect[1]+after_rect[3])//2 << 16 | (after_rect[0]+1)&0xffff
            assert u.SendMessageTimeoutW(hwnd, 0x84, 0, edge, 2, 300, c.byref(native_result))
            report['leftEdgeHit'] = native_result.value
            assert native_result.value == 10, 'Native resize border did not return HTLEFT'
            page.locator('.startup-chrome').get_by_role('button', name='最小化', exact=True).click()
            wait(lambda: u.IsIconic(hwnd))
            assert u.PostMessageW(hwnd, 0x112, 0xf120, 0)
            wait(lambda: not u.IsIconic(hwnd))
            assert splash.is_visible(), 'Window actions were only tested after loading'
            page.screenshot(path=str(root / 'startup-resized.png'))
            splash.wait_for(state='hidden', timeout=30000)
            report.update(status='PASS: native window remains responsive during slow SQL startup',
                          before=before_rect, after=after_rect,
                          cases=['native message pump', 'maximize/restore', 'single native double click',
                                 'blank-area native drag', 'native move/resize', 'resize border', 'minimize/restore', 'startup completes'])
        (root / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False))
        browser.close()
finally:
    if app.poll() is None:
        assert root.is_relative_to(Path(tempfile.gettempdir())) and root.name.startswith('ero-startup-window-')
        app.terminate()
        app.wait(timeout=10)
    u.CloseDesktop(desktop)
    assert u.GetForegroundWindow() == foreground, 'Test changed the user foreground window'
