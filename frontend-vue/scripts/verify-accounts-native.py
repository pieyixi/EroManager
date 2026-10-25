import sqlite3, pathlib, tempfile, shutil, subprocess, json, hashlib
root=pathlib.Path(tempfile.mkdtemp(prefix='ero-accounts-native-'))/'ero-manager'; (root/'lib').mkdir(parents=True);(root/'db').mkdir()
build=pathlib.Path('D:/Code/Ero-Manager/src-tauri/target/path-verification/release')
shutil.copy2(build/'ero-manager-admin.exe',root/'ero-manager-admin.exe')
for source,target in [(build/'ero-manager.exe',root/'ero-manager.exe'),(build/'ero_manager_lib.dll',root/'lib/ero_manager_lib.dll'),(pathlib.Path('D:/Code/Ero-Manager/src-tauri/lib/libmpv-2.dll'),root/'lib/libmpv-2.dll'),(pathlib.Path('D:/Code/Ero-Manager/src-tauri/lib/libmpv-wrapper.dll'),root/'lib/libmpv-wrapper.dll')]:shutil.copy2(source,target)
conn=sqlite3.connect(root/'db/database.db');conn.executescript("CREATE TABLE AppSettings(Key TEXT PRIMARY KEY,Value TEXT);CREATE TABLE FavoriteCharacters(CharacterName TEXT PRIMARY KEY);INSERT INTO FavoriteCharacters VALUES('fixture character');CREATE TABLE WorkRecords(Kind TEXT,ContentId INTEGER,Position REAL,PairOffset INTEGER,MergedPairs TEXT,UpdatedAt TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(Kind,ContentId));INSERT INTO WorkRecords(Kind,ContentId,Position,PairOffset,MergedPairs) VALUES('book',-123,12,1,'[]');")
conn.execute('INSERT INTO AppSettings VALUES(?,?)',('user_preferences_v1',json.dumps({'theme':'dark','player_volume':37})));conn.commit();conn.close()
eh=sqlite3.connect(root/'db/eh-database.db');eh.executescript('CREATE TABLE EhFavoriteGalleries(Gid INTEGER PRIMARY KEY);INSERT INTO EhFavoriteGalleries VALUES(123),(-123);');eh.commit();eh.close()
script='\n'.join(['2468','2468','1','fixture duplicate','1234','1234','0001','2','0002','0088','3','0088','fixture renamed','4','0088','5678','5678','5','0088','5','0088','0',''])
run=subprocess.run([str(root/'ero-manager.exe'),'--admin','--stdio'],input=script,encoding='utf-8',stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=40,cwd=root)
(root/'tui-create.txt').write_text(run.stdout+run.stderr,encoding='utf-8')
conn=sqlite3.connect(root/'db/database.db'); key=conn.execute("SELECT AccountKey FROM Accounts WHERE LoginId='0088'").fetchone()[0]
assert key==3; nickname,salt,digest,disabled=conn.execute('SELECT Nickname,PinSalt,PinHash,Disabled FROM Accounts WHERE AccountKey=?',(key,)).fetchone()
assert nickname=='fixture renamed' and not disabled and hashlib.pbkdf2_hmac('sha256',b'5678',salt,120000)==digest
assert json.loads(conn.execute("SELECT Value FROM AccountValues WHERE AccountKey=3 AND Kind='preferences'").fetchone()[0])['player_volume']==37
assert conn.execute("SELECT COUNT(*) FROM AccountValues WHERE AccountKey=3 AND Kind='favorite-book'").fetchone()[0]==0
assert set(x[0] for x in conn.execute("SELECT Item FROM AccountValues WHERE AccountKey=2 AND Kind='favorite-book'"))=={'123','-123'}
assert conn.execute("SELECT COUNT(*) FROM WorkRecords").fetchone()[0]==1
assert conn.execute("SELECT COUNT(*) FROM FavoriteCharacters").fetchone()[0]==1
backup_dir=root.parent/'backup/ero-manager backup'
backups=list(backup_dir.glob('账号迁移前_*.db'))
assert len(backups)==1
snapshot=sqlite3.connect(backups[0])
assert snapshot.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='Accounts'").fetchone()[0]==0
assert snapshot.execute("SELECT CharacterName FROM FavoriteCharacters").fetchone()[0]=='fixture character'
snapshot.close()
assert not (root/'db/runtime').exists()
assert not (root/'db/eh-database.db').exists()
merged_backups=list(backup_dir.glob('并库前_*'))
assert len(merged_backups)==1 and (merged_backups[0]/'eh-database.db').is_file()
assert set(x[0] for x in conn.execute('SELECT Gid FROM EhFavoriteGalleries'))=={123,-123}
assert not list((root/'db').glob('*.lock')) and not list((root/'db').glob('before-accounts-*.db'))
conn.execute("INSERT INTO AccountValues(AccountKey,Kind,Item,Value) VALUES(3,'record','book:123','fixture')");conn.commit();conn.close()
run=subprocess.run([str(root/'ero-manager.exe'),'--admin','--stdio'],input='2468\n6\n0088\n0088\n0\n',encoding='utf-8',stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30,cwd=root)
(root/'tui-delete.txt').write_text(run.stdout+run.stderr,encoding='utf-8');conn=sqlite3.connect(root/'db/database.db')
assert conn.execute('SELECT COUNT(*) FROM AccountValues WHERE AccountKey=3').fetchone()[0]==0
assert conn.execute("SELECT COUNT(*) FROM AccountValues WHERE AccountKey=2 AND Kind='record'").fetchone()[0]==1
assert conn.execute('PRAGMA integrity_check').fetchone()[0]=='ok';conn.close()
assert list(backup_dir.glob('账号迁移前_*.db'))==backups
# Read the real terminal's first banner before probing its exclusive portable-directory lock.
held=subprocess.Popen([str(root/'ero-manager.exe'),'--admin','--stdio'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,encoding='utf-8',cwd=root)
try:
    while True:
        banner=held.stdout.readline()
        assert banner, 'Admin terminal exited before acquiring the lock'
        if banner.strip():break
    collision=subprocess.run([str(root/'ero-manager.exe'),'--admin','--stdio'],input='',encoding='utf-8',stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10,cwd=root)
    assert collision.returncode==2, collision.stdout+collision.stderr
finally:
    held.communicate('2468\n0\n',timeout=10)
assert held.returncode==0
print(json.dumps({'status':'PASS native TUI: create / ID rename / nickname / salted PIN reset / disable-enable / account-only deletion / legacy migration / consistent backup / exclusive process lock','root':str(root)},ensure_ascii=False))
pathlib.Path(tempfile.gettempdir(),'ero-accounts-native-path.txt').write_text(str(root),encoding='utf-8')
