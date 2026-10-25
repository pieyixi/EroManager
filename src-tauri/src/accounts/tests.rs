use super::*;
use rusqlite::Connection;
fn fixture() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE AppSettings(Key TEXT PRIMARY KEY,Value TEXT);CREATE TABLE FavoriteCharacters(CharacterName TEXT);INSERT INTO FavoriteCharacters VALUES('枫');INSERT INTO AppSettings VALUES('user_preferences_v1','{\"theme\":\"dark\"}');CREATE TABLE WorkRecords(Kind TEXT,ContentId INTEGER,Position REAL,PairOffset INTEGER,MergedPairs TEXT);INSERT INTO WorkRecords VALUES('book',-42,12,1,'[]');").unwrap();
    initialize(&mut conn, false).unwrap();
    conn
}
#[test]
fn legacy_data_migrates_once_without_removing_originals() {
    let mut conn = fixture();
    assert_eq!(
        storage::favorites(&conn, 2, "favorite-media").unwrap(),
        vec!["枫"]
    );
    assert!(read_value(&conn, 2, "record", "book:-42")
        .unwrap()
        .unwrap()
        .contains("12"));
    initialize(&mut conn, false).unwrap();
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM Accounts", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM FavoriteCharacters", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn shared_book_deletion_clears_all_account_favorites_atomically() {
    let mut conn = fixture();
    crate::eh::database::initialize_eh_schema(&conn).unwrap();
    initialize(&mut conn, false).unwrap();
    storage::create(&conn, "second", "", None).unwrap();
    conn.execute_batch("INSERT INTO EhGalleries(Gid,Token,Title,Category,ArtistJson,GroupJson,TagsJson,Pages,Posted,CoverPath,FolderPath,SourceId) VALUES(123,'','work',2,'[]','[]','[]',1,'','','folder','123');").unwrap();
    for key in [2, 3] {
        storage::favorite(&conn, key, "favorite-book", "123", true).unwrap();
    }
    conn.execute_batch("BEGIN; DELETE FROM EhGalleries WHERE Gid=123;")
        .unwrap();
    assert!(storage::favorites(&conn, 2, "favorite-book")
        .unwrap()
        .is_empty());
    conn.execute_batch("ROLLBACK;").unwrap();
    assert_eq!(
        storage::favorites(&conn, 3, "favorite-book").unwrap(),
        vec!["123"]
    );
    conn.execute("DELETE FROM EhGalleries WHERE Gid=123", [])
        .unwrap();
    assert!(storage::favorites(&conn, 2, "favorite-book")
        .unwrap()
        .is_empty());
    assert!(storage::favorites(&conn, 3, "favorite-book")
        .unwrap()
        .is_empty());
}
#[test]
fn account_id_changes_preserve_personal_records_and_reject_collisions() {
    let conn = fixture();
    assert_eq!(
        storage::create(&conn, "本地资料库", "1234", Some(2)).unwrap(),
        "0002"
    );
    let key = conn
        .query_row(
            "SELECT AccountKey FROM Accounts WHERE LoginId='0002'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap();
    assert!(read_value(&conn, key, "preferences", "").unwrap().is_some());
    assert!(storage::favorites(&conn, key, "favorite-media")
        .unwrap()
        .is_empty());
    write_value(&conn, key, "record", "book:-7", "kept").unwrap();
    tui::rename_id(&conn, key, "0088").unwrap();
    assert_eq!(
        read_value(&conn, key, "record", "book:-7")
            .unwrap()
            .unwrap(),
        "kept"
    );
    assert!(tui::rename_id(&conn, key, "0001").is_err());
    assert!(tui::rename_id(&conn, key, "0000").is_err());
    assert!(storage::verify_pin(&conn, key, "1234").unwrap());
    assert!(!storage::verify_pin(&conn, key, "0000").unwrap());
    tui::delete(&conn, key).unwrap();
    assert!(read_value(&conn, key, "record", "book:-7")
        .unwrap()
        .is_none());
    assert!(read_value(&conn, 2, "record", "book:-42")
        .unwrap()
        .is_some());
}
#[test]
fn scopes_expire_and_do_not_follow_active_account() {
    let conn = fixture();
    let session = Session::new(&conn).unwrap();
    let old = session.0.lock().unwrap().token.clone();
    assert_eq!(session.authorize(&old).unwrap(), 2);
    session.0.lock().unwrap().activate(3).unwrap();
    assert!(session.authorize(&old).is_err());
    let token = session.0.lock().unwrap().token.clone();
    session.0.lock().unwrap().token.clear();
    assert!(session.authorize(&token).is_err());
}
#[test]
fn restart_requires_pin_and_keeps_draw_history() {
    let conn = fixture();
    write_value(
        &conn,
        2,
        "draw",
        "media",
        "{\"seen\":[1,2],\"recent\":[1,2]}",
    )
    .unwrap();
    storage::set_pin(&conn, 2, "0987").unwrap();
    let session = Session::new(&conn).unwrap();
    assert!(session.0.lock().unwrap().token.is_empty());
    assert!(read_value(&conn, 2, "draw", "media")
        .unwrap()
        .unwrap()
        .contains("1,2"));
    assert!(tui::delete(&conn, 1).is_err());
    assert!(tui::delete(&conn, 2).is_err());
}
#[test]
fn personal_book_favorites_keep_signed_ids_and_global_deletion_removes_every_owner() {
    let conn = fixture();
    storage::create(&conn, "same nickname", "", None).unwrap();
    for key in [2, 3] {
        storage::favorite(&conn, key, "favorite-book", "123", true).unwrap();
        storage::favorite(&conn, key, "favorite-book", "-123", true).unwrap();
    }
    forget_gallery(&conn, -123).unwrap();
    for key in [2, 3] {
        assert_eq!(
            storage::favorites(&conn, key, "favorite-book").unwrap(),
            vec!["123"]
        );
    }
    storage::favorite(&conn, 3, "favorite-media", "new", true).unwrap();
    assert_eq!(
        storage::favorites(&conn, 2, "favorite-media").unwrap(),
        vec!["枫"]
    );
    assert_eq!(
        storage::favorites(&conn, 3, "favorite-media").unwrap(),
        vec!["new"]
    );
}

#[test]
fn backend_limits_pin_attempts_and_uses_unique_salts() {
    let conn = fixture();
    let session = Session::new(&conn).unwrap();
    let mut state = session.0.lock().unwrap();
    for _ in 0..4 {
        state.failed();
        assert!(state.check_attempt().is_ok());
    }
    state.failed();
    let error = state.check_attempt().unwrap_err();
    assert!(error.contains("秒后再试"));
    state.cooldown = Some(std::time::Instant::now() - std::time::Duration::from_secs(1));
    assert!(state.check_attempt().is_ok());
    state.activate(2).unwrap();
    assert!(state.cooldown.is_none());
    let (salt_a, hash_a) = security::hash_pin("1234").unwrap();
    let (salt_b, hash_b) = security::hash_pin("1234").unwrap();
    assert_ne!(salt_a, salt_b);
    assert_ne!(hash_a, hash_b);
    assert!(security::verify("1234", &salt_a, &hash_a));
    assert!(!security::verify("1234", &salt_b, &hash_a));
}

#[test]
fn admin_requests_authenticate_and_preserve_data_through_id_change_and_delete() {
    use super::admin::{Action, Guard, Request};
    let conn = fixture();
    let mut guard = Guard::default();
    assert!(
        !admin::handle(
            &conn,
            &mut guard,
            Request {
                pin: String::new(),
                action: Action::Status
            }
        )
        .unwrap()
        .0
        .configured
    );
    assert!(admin::handle(
        &conn,
        &mut guard,
        Request {
            pin: "2468".into(),
            action: Action::Create {
                nickname: "新账号".into(),
                pin: String::new(),
                copy: String::new()
            }
        }
    )
    .is_err());
    let mut run = |action| {
        admin::handle(
            &conn,
            &mut guard,
            Request {
                pin: "2468".into(),
                action,
            },
        )
    };
    run(Action::Authenticate).unwrap();
    let reply = run(Action::Create {
        nickname: "同名".into(),
        pin: "0123".into(),
        copy: "0001".into(),
    })
    .unwrap()
    .0;
    let new = reply
        .users
        .iter()
        .find(|user| user.id == "0002")
        .unwrap()
        .key;
    write_value(&conn, new, "record", "book:7", "fixture").unwrap();
    run(Action::RenameId {
        key: new,
        id: "0088".into(),
    })
    .unwrap();
    assert_eq!(
        read_value(&conn, new, "record", "book:7")
            .unwrap()
            .as_deref(),
        Some("fixture")
    );
    assert!(run(Action::RenameId {
        key: new,
        id: "0000".into()
    })
    .is_err());
    assert!(run(Action::RenameId {
        key: new,
        id: "0001".into()
    })
    .is_err());
    assert!(run(Action::Delete {
        key: new,
        confirm: "0002".into()
    })
    .is_err());
    run(Action::Delete {
        key: new,
        confirm: "0088".into(),
    })
    .unwrap();
    assert!(read_value(&conn, new, "record", "book:7")
        .unwrap()
        .is_none());
    assert_eq!(
        storage::favorites(&conn, 2, "favorite-media").unwrap(),
        vec!["枫"]
    );
    assert!(run(Action::Toggle { key: 2 }).is_err());
    assert!(run(Action::Delete {
        key: 2,
        confirm: "0001".into()
    })
    .is_err());
}

#[test]
fn admin_changes_revoke_only_affected_sessions_and_reject_stale_scope() {
    use super::admin::{Action, Guard, Request};
    let conn = fixture();
    let mut guard = Guard::default();
    admin::handle(
        &conn,
        &mut guard,
        Request {
            pin: "2468".into(),
            action: Action::Authenticate,
        },
    )
    .unwrap();
    storage::create(&conn, "另一个", "", None).unwrap();
    let session = Session::new(&conn).unwrap();
    let mut state = session.0.lock().unwrap();
    state.activate(2).unwrap();
    let original = state.token.clone();
    let mut change = |action| {
        admin::handle(
            &conn,
            &mut guard,
            Request {
                pin: "2468".into(),
                action,
            },
        )
        .unwrap()
        .1
        .unwrap()
    };
    assert!(!change(Action::Rename {
        key: 2,
        nickname: "新昵称".into()
    })
    .apply(&mut state));
    assert_eq!(state.authorize(&original).unwrap(), 2);
    assert!(!change(Action::ResetPin {
        key: 3,
        pin: "1234".into()
    })
    .apply(&mut state));
    assert_eq!(state.authorize(&original).unwrap(), 2);
    assert!(change(Action::ResetPin {
        key: 2,
        pin: "5678".into()
    })
    .apply(&mut state));
    assert!(state.authorize(&original).is_err());
    assert!(storage::verify_pin(&conn, 2, "5678").unwrap());
    state.activate(2).unwrap();
    assert!(change(Action::Toggle { key: 2 }).apply(&mut state));
    assert!(state.token.is_empty());
}

#[test]
fn administrator_wrong_password_does_not_modify_accounts_and_cools_down() {
    use super::admin::{Action, Guard, Request};
    let conn = fixture();
    let mut guard = Guard::default();
    admin::handle(
        &conn,
        &mut guard,
        Request {
            pin: "2468".into(),
            action: Action::Authenticate,
        },
    )
    .unwrap();
    for _ in 0..5 {
        assert!(admin::handle(
            &conn,
            &mut guard,
            Request {
                pin: "0000".into(),
                action: Action::Toggle { key: 2 }
            }
        )
        .is_err());
    }
    let error = admin::handle(
        &conn,
        &mut guard,
        Request {
            pin: "2468".into(),
            action: Action::Authenticate,
        },
    )
    .err()
    .unwrap();
    assert!(error.contains("秒后再试"));
    assert!(!conn
        .query_row(
            "SELECT Disabled FROM Accounts WHERE AccountKey=2",
            [],
            |row| row.get::<_, bool>(0)
        )
        .unwrap());
}
