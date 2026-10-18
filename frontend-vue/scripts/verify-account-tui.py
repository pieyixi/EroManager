"""隔离便携夹具 + 隐藏控制台的真实键盘验证；GUI 放在独立桌面，不切换用户桌面。"""
import ctypes as c, ctypes.wintypes as w
import hashlib, json, os, pathlib, shutil, sqlite3, subprocess, tempfile, time, sys

build = pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'D:/Code/Ero-Manager/src-tauri/target/path-verification/release')
root = pathlib.Path(tempfile.mkdtemp(prefix='ero-admin-tui-'))
pathlib.Path(tempfile.gettempdir(),'ero-admin-tui-latest.txt').write_text(str(root),encoding='utf-8')
(root/'lib').mkdir(); (root/'db').mkdir()
for source, target in [('ero-manager.exe','ero-manager.exe'),('ero-manager-admin.exe','ero-manager-admin.exe'),('ero_manager_lib.dll','lib/ero_manager_lib.dll'),('lib/libmpv-2.dll','lib/libmpv-2.dll'),('lib/libmpv-wrapper.dll','lib/libmpv-wrapper.dll')]:
    location=build/source
    if not location.exists() and source=='ero_manager_lib.dll': location=build/'deps'/source
    shutil.copy2(location, root/target)
db = sqlite3.connect(root/'db/database.db')
db.executescript("CREATE TABLE AppSettings(Key TEXT PRIMARY KEY,Value TEXT); CREATE TABLE FavoriteCharacters(CharacterName TEXT PRIMARY KEY); INSERT INTO FavoriteCharacters VALUES('fixture'); CREATE TABLE WorkRecords(Kind TEXT,ContentId INTEGER,Position REAL,PairOffset INTEGER,MergedPairs TEXT,PRIMARY KEY(Kind,ContentId));")
db.execute('INSERT INTO AppSettings VALUES(?,?)',('user_preferences_v1',json.dumps({'player_volume':37}))); db.commit(); db.close()
k, u = c.windll.kernel32, c.windll.user32
k.GetStdHandle.restype=w.HANDLE
k.CreateFileW.restype=w.HANDLE
k.CreateFileW.argtypes=[w.LPCWSTR,w.DWORD,w.DWORD,c.c_void_p,w.DWORD,w.DWORD,w.HANDLE]
k.GetConsoleMode.argtypes=[w.HANDLE,c.POINTER(w.DWORD)]
k.SetConsoleMode.argtypes=[w.HANDLE,w.DWORD]
k.CloseHandle.argtypes=[w.HANDLE]
u.CreateDesktopW.restype=w.HANDLE
u.CreateDesktopW.argtypes=[w.LPCWSTR,w.LPCWSTR,c.c_void_p,w.DWORD,w.DWORD,c.c_void_p]
u.CloseDesktop.argtypes=[w.HANDLE]
class Char(c.Union): _fields_=[('UnicodeChar',w.WCHAR),('AsciiChar',c.c_char)]
class Key(c.Structure): _fields_=[('down',w.BOOL),('repeat',w.WORD),('virtual',w.WORD),('scan',w.WORD),('char',Char),('state',w.DWORD)]
class Event(c.Union): _fields_=[('key',Key),('padding',c.c_byte*16)]
class Record(c.Structure): _fields_=[('kind',w.WORD),('event',Event)]
class Coord(c.Structure): _fields_=[('x',w.SHORT),('y',w.SHORT)]
class Rect(c.Structure): _fields_=[('left',w.SHORT),('top',w.SHORT),('right',w.SHORT),('bottom',w.SHORT)]
class BufferInfo(c.Structure): _fields_=[('size',Coord),('cursor',Coord),('attributes',w.WORD),('window',Rect),('maximum',Coord)]
class CharInfo(c.Structure): _fields_=[('char',Char),('attributes',w.WORD)]
k.GetConsoleScreenBufferInfo.argtypes=[w.HANDLE,c.POINTER(BufferInfo)]
k.ReadConsoleOutputW.argtypes=[w.HANDLE,c.POINTER(CharInfo),Coord,Coord,c.POINTER(Rect)]
k.WriteConsoleInputW.argtypes=[w.HANDLE,c.POINTER(Record),w.DWORD,c.POINTER(w.DWORD)]
assert c.sizeof(Record)==20
startup=subprocess.STARTUPINFO(); startup.dwFlags=subprocess.STARTF_USESHOWWINDOW; startup.wShowWindow=0
app=None; desktop=None; admin=None; input_handle=None; output_handle=None
try:
    admin=subprocess.Popen([str(root/'ero-manager-admin.exe')],cwd=root,startupinfo=startup,creationflags=subprocess.CREATE_NEW_CONSOLE)
    k.FreeConsole()
    for attempt in range(60):
        if k.AttachConsole(admin.pid): break
        assert admin.poll() is None, 'TUI exited before attaching'
        time.sleep(.1)
    else: raise AssertionError('Unable to attach hidden test console')
    time.sleep(.5)
    input_handle=k.CreateFileW('CONIN$',0xc0000000,3,None,3,0,None)
    output_handle=k.CreateFileW('CONOUT$',0xc0000000,3,None,3,0,None)
    def screen():
        info=BufferInfo(); assert k.GetConsoleScreenBufferInfo(output_handle,c.byref(info))
        width=info.window.right-info.window.left+1; height=info.window.bottom-info.window.top+1
        data=(CharInfo*(width*height))(); bounds=info.window
        assert k.ReadConsoleOutputW(output_handle,data,Coord(width,height),Coord(0,0),c.byref(bounds))
        return '\n'.join(''.join(item.char.UnicodeChar or ' ' for item in data[row*width:(row+1)*width] if not item.attributes & 0x200) for row in range(height))
    def wait(text,timeout=12):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            assert admin.poll() is None, 'TUI unexpectedly exited'
            value=screen()
            if text in value: return value
            time.sleep(.08)
        (root/'failed-console.txt').write_text(screen(),encoding='utf-8')
        raise AssertionError('Missing console text: '+text)
    def press(virtual=0,text=''):
        record=Record(); record.kind=1; record.event.key.down=True; record.event.key.repeat=1; record.event.key.virtual=virtual
        if text: record.event.key.char.UnicodeChar=text
        count=w.DWORD(); assert k.WriteConsoleInputW(input_handle,c.byref(record),1,c.byref(count))
        time.sleep(.045)
    def type_text(value):
        for char in value: press(text=char)
    def enter(): press(0x0d)
    def down(): press(0x28)
    def field(value=''): type_text(value); enter()
    def query(sql,args=()):
        with sqlite3.connect(root/'db/database.db') as conn: return conn.execute(sql,args).fetchall()
    wait('设置管理员四位密码'); field('2468'); field('2468'); wait('独立管理'); wait('创建账号')
    press(0x27); enter(); wait('昵称（允许重名）')
    field('测试账号'); field(); field(); field('0001'); wait('已创建账号 0002')
    assert query("SELECT Nickname FROM Accounts WHERE LoginId='0002'")==[('测试账号',)]
    assert json.loads(query("SELECT Value FROM AccountValues WHERE AccountKey=3 AND Kind='preferences'")[0][0])['player_volume']==37
    press(0x25); down(); press(0x27); down(); enter(); wait('新的四位 ID')
    for _ in range(4): press(0x08)
    field('0088'); wait('操作完成'); assert query("SELECT LoginId FROM Accounts WHERE AccountKey=3")==[('0088',)]
    (root/'offline-screen.txt').write_text(screen(),encoding='utf-8')

    # TUI 已打开时启动 GUI，真实验证不再共用整进程独占锁。
    desktop_name='EroAdminQA'+str(os.getpid())
    desktop=u.CreateDesktopW(desktop_name,None,None,0,0x1ff,None); assert desktop
    gui_start=subprocess.STARTUPINFO(); gui_start.lpDesktop=desktop_name; gui_start.dwFlags=subprocess.STARTF_USESHOWWINDOW; gui_start.wShowWindow=0
    app=subprocess.Popen([str(root/'ero-manager.exe')],cwd=root,startupinfo=gui_start)
    time.sleep(4); assert app.poll() is None
    press(text='r'); wait('已连接主程序',timeout=20)
    (root/'connected-screen.txt').write_text(screen(),encoding='utf-8')
    # 通过 GUI 后端修改同一个账号；原生子进程仍保持运行。
    down(); enter(); wait('新昵称')
    for _ in range(24): press(0x08)
    field('已改昵称'); wait('操作完成'); assert query('SELECT Nickname FROM Accounts WHERE AccountKey=3')==[('已改昵称',)]
    down(); enter(); wait('新密码（留空关闭）'); field('1234'); field('1234'); wait('操作完成')
    salt,digest=query('SELECT PinSalt,PinHash FROM Accounts WHERE AccountKey=3')[0]
    assert hashlib.pbkdf2_hmac('sha256',b'1234',salt,120000)==digest
    down(); enter(); wait('输入当前账号 ID 确认'); field('0088'); wait('操作完成'); assert query('SELECT Disabled FROM Accounts WHERE AccountKey=3')==[(1,)]
    enter(); wait('输入当前账号 ID 确认'); field('0088'); wait('操作完成'); assert query('SELECT Disabled FROM Accounts WHERE AccountKey=3')==[(0,)]
    down(); enter(); wait('输入当前账号 ID 确认删除'); press(0x1b); wait('已取消'); assert query('SELECT COUNT(*) FROM Accounts WHERE AccountKey=3')==[(1,)]
    enter(); wait('输入当前账号 ID 确认删除'); field('0088'); wait('操作完成'); assert query('SELECT COUNT(*) FROM Accounts WHERE AccountKey=3')==[(0,)]
    press(0x25); down(); press(0x27); enter(); wait('输入当前账号 ID 确认删除'); field('0001'); wait('至少保留一个')
    assert query("SELECT Item FROM AccountValues WHERE AccountKey=2 AND Kind='favorite-media'")==[('fixture',)]
    down(); enter(); wait('新的四位密码'); field('5678'); field('5678'); wait('操作完成'); press(text='r'); wait('列表已刷新')
    assert app.poll() is None
    press(0x1b); assert admin.wait(timeout=10)==0
    mode=w.DWORD(); assert k.GetConsoleMode(input_handle,c.byref(mode)); assert mode.value & 6 == 6, 'Console input mode was not restored'
    (root/'result.json').write_text(json.dumps({'status':'PASS','root':str(root),'cases':['real hidden console keyboard navigation','first admin PIN','offline creation / copied preferences / ID change','GUI starts while TUI is open','named-pipe authenticated administration','nickname / PIN reset / disable-enable / delete cancellation and confirmation','last-account and personal-data boundaries','admin PIN change / reauthentication','console mode restoration']},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'status':'PASS native TUI and GUI coexistence','root':str(root)}))
finally:
    if admin and admin.poll() is None: admin.terminate(); admin.wait(timeout=10)
    if input_handle: k.CloseHandle(input_handle)
    if output_handle: k.CloseHandle(output_handle)
    k.FreeConsole()
    if app and app.poll() is None:
        assert root.is_relative_to(pathlib.Path(tempfile.gettempdir())) and root.name.startswith('ero-admin-tui-')
        app.terminate(); app.wait(timeout=10)
    if desktop: u.CloseDesktop(desktop)
