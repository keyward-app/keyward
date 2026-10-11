//! One authenticated sync operation with explicit account identity and a
//! persistence callback. Rotation is saved before the next network request;
//! the full snapshot is then committed together with protected-key metadata.
use crate::session::Session;

#[derive(Default)]
struct AccountGate {
    operation: tokio::sync::Mutex<()>,
    publication: std::sync::Mutex<()>,
    epoch: std::sync::atomic::AtomicU64,
}
fn account_lock(id: &str) -> std::sync::Arc<AccountGate> {
    type Locks = std::collections::HashMap<String, std::sync::Weak<AccountGate>>;
    static LOCKS: std::sync::OnceLock<std::sync::Mutex<Locks>> = std::sync::OnceLock::new();
    let mut locks = LOCKS.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(id).and_then(std::sync::Weak::upgrade) { return lock; }
    let lock = std::sync::Arc::new(AccountGate::default());
    locks.insert(id.to_string(), std::sync::Arc::downgrade(&lock));
    lock
}

pub(crate) fn invalidate<T>(id: &str, forget: impl FnOnce() -> T) -> T {
    let gate = account_lock(id);
    let _publication = gate.publication.lock().unwrap_or_else(|e| e.into_inner());
    gate.epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    forget()
}

pub(crate) async fn synchronize(
    id: &str, server: &str, identity: &str,
    load: impl FnOnce() -> anyhow::Result<Session>,
    mut persist: impl FnMut(&Session) -> anyhow::Result<()>,
) -> anyhow::Result<usize> {
    let lock = account_lock(id);
    let _guard = lock.operation.lock().await;
    // Read inside the account lock: a queued sync/write must use the token
    // rotated by its predecessor rather than refreshing the same old token.
    let (mut db, epoch) = {
        let _publication = lock.publication.lock().unwrap_or_else(|e| e.into_inner());
        (load()?, lock.epoch.load(std::sync::atomic::Ordering::SeqCst))
    };
    run(server, identity, &mut db, |db| {
        let _publication = lock.publication.lock().unwrap_or_else(|e| e.into_inner());
        if lock.epoch.load(std::sync::atomic::Ordering::SeqCst) != epoch {
            return Err(keyward_core::fault!("err.sessionEnded"));
        }
        persist(db)
    }).await
}

async fn refresh(identity: &str, db: &mut Session, persist: &mut impl FnMut(&Session) -> anyhow::Result<()>) -> anyhow::Result<()> {
    let token = db.refresh_token.as_deref().ok_or_else(|| keyward_core::fault!("err.noTokens"))?;
    match keyward_bw::identity::refresh(identity, token).await {
        Ok(tokens) => { super::rotate(db, tokens); persist(db) }
        Err(e) if e.to_string() == "err.sessionEnded" => {
            db.access_token = None; db.refresh_token = None;
            persist(db)?;
            Err(keyward_core::fault!("err.sessionEnded"))
        }
        Err(e) => Err(keyward_core::fault!("err.syncFailed", "reason" => e)),
    }
}

pub(crate) async fn run(
    server: &str, identity: &str, db: &mut Session,
    mut persist: impl FnMut(&Session) -> anyhow::Result<()>,
) -> anyhow::Result<usize> {
    let token = db.access_token.as_deref().ok_or_else(|| keyward_core::fault!("err.noTokens"))?;
    if db.refresh_token.is_none() { return Err(keyward_core::fault!("err.noTokens")); }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs();
    if keyward_bw::identity::spent(token, now, 60) { refresh(identity, db, &mut persist).await?; }
    let snapshot = match keyward_bw::sync::fetch(server, db.access_token.as_deref().unwrap_or_default()).await {
        Ok(snapshot) => snapshot,
        Err(e) if e.to_string() == "err.sessionExpired" => {
            refresh(identity, db, &mut persist).await?;
            keyward_bw::sync::fetch(server, db.access_token.as_deref().unwrap_or_default()).await
                .map_err(|e| keyward_core::fault!("err.syncFailed", "reason" => e))?
        }
        Err(e) => return Err(keyward_core::fault!("err.syncFailed", "reason" => e)),
    };
    let key = snapshot.profile.key.clone().ok_or_else(||
        keyward_core::fault!("err.syncFailed", "reason" => "sync profile has no protected key"))?;
    let count = snapshot.ciphers.len();
    db.protected_key = Some(key);
    db.protected_private_key = snapshot.profile.private_key.clone();
    db.protected_org_keys = snapshot.profile.organizations.iter()
        .filter_map(|org| Some((org.id.clone(), org.key.clone()?))).collect();
    db.snapshot = Some(snapshot);
    persist(db)?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use base64::Engine as _;

    fn token(label: &str) -> String {
        let exp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()+3600;
        format!("e30.{}.signature", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
            serde_json::json!({"exp":exp,"label":label}).to_string()))
    }

    fn server(replies: Vec<(u16, String)>) -> (String, Arc<Mutex<Vec<String>>>, std::thread::JoinHandle<()>) {
        server_with_hook(replies, |_| {})
    }
    fn server_with_hook(replies: Vec<(u16, String)>, mut before_reply: impl FnMut(&str) + Send + 'static) -> (String, Arc<Mutex<Vec<String>>>, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = requests.clone();
        let thread = std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
            for (status, body) in replies {
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream,_)) => break stream,
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(std::time::Instant::now() < deadline, "test HTTP server timed out");
                            std::thread::sleep(std::time::Duration::from_millis(2));
                        }
                        Err(e) => panic!("{e}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
                let mut data = Vec::new(); let mut buf = [0;4096];
                loop {
                    let n = stream.read(&mut buf).unwrap(); if n == 0 { break; }
                    data.extend_from_slice(&buf[..n]);
                    if let Some(end) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&data[..end]).to_lowercase();
                        let len = header.lines().find_map(|l| l.strip_prefix("content-length: ").and_then(|l| l.trim().parse::<usize>().ok())).unwrap_or(0);
                        if data.len() >= end + 4 + len { break; }
                    }
                }
                seen.lock().unwrap().push(String::from_utf8(data).unwrap());
                before_reply(&body);
                write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        (url, requests, thread)
    }
    fn session() -> Session {
        let mut db = Session::new(); db.access_token = Some(token("old"));
        db.refresh_token = Some("old-refresh".into());
        db.snapshot = Some(serde_json::from_value(serde_json::json!({"profile":{"id":"old"},"ciphers":[{"id":"old-item"}]})).unwrap());
        db
    }
    fn body() -> String {
        serde_json::json!({"profile":{"key":"2.new-user","privateKey":"2.new-private","organizations":[{"id":"org","key":"4.new-org"}]},"ciphers":[{"id":"new-item"}]}).to_string()
    }

    #[tokio::test]
    async fn unauthorized_sync_rotates_and_persists_before_retry_then_commits_one_snapshot() {
        let fresh = token("fresh");
        let (url, seen, thread) = server(vec![(401,"{}".into()),(200,serde_json::json!({"access_token":fresh,"refresh_token":"fresh-refresh"}).to_string()),(200,body())]);
        let mut db = session(); let mut commits = Vec::new();
        let count = run(&url, &url, &mut db, |db| { commits.push(serde_json::to_value(db)?); Ok(()) }).await.unwrap();
        thread.join().unwrap();
        assert_eq!(count,1); assert_eq!(commits.len(),2);
        assert_eq!(commits[0]["refresh_token"],"fresh-refresh");
        assert_eq!(commits[0]["snapshot"]["ciphers"][0]["id"],"old-item");
        assert_eq!(commits[1]["snapshot"]["ciphers"][0]["id"],"new-item");
        assert_eq!(commits[1]["protected_org_keys"]["org"],"4.new-org");
        let requests = seen.lock().unwrap();
        assert!(requests[0].starts_with("GET /api/sync"));
        assert!(requests[1].starts_with("POST /connect/token"));
        assert!(requests[1].contains("old-refresh"));
        assert!(requests[2].to_lowercase().contains(&format!("authorization: bearer {fresh}").to_lowercase()));
    }

    #[tokio::test]
    async fn failed_fetch_and_failed_snapshot_commit_never_report_success() {
        let (url, _, thread) = server(vec![(500,"{}".into())]);
        let mut db = session(); let mut commits = 0;
        assert!(run(&url,&url,&mut db, |_| { commits += 1; Ok(()) }).await.is_err());
        thread.join().unwrap(); assert_eq!(commits,0);
        assert_eq!(db.snapshot.unwrap().ciphers[0].id,"old-item");
        let (url, _, thread) = server(vec![(200,body())]);
        let mut db = session();
        let mut attempts = 0;
        let err = run(&url,&url,&mut db, |_| {
            attempts += 1; anyhow::bail!("test disk failure")
        }).await.err().unwrap();
        thread.join().unwrap();
        assert_eq!(attempts,1);
        assert!(err.to_string().contains("test disk failure"));
        // The callback is the publication boundary; callers discard the
        // temporary mutated session when persistence fails.
    }

    #[tokio::test]
    async fn concurrent_operations_reload_saved_rotation_instead_of_refreshing_twice() {
        let fresh = token("concurrent-fresh");
        let (url, seen, thread) = server(vec![(401,"{}".into()),
            (200,serde_json::json!({"access_token":fresh,"refresh_token":"rotated"}).to_string()),
            (200,body()),(200,body())]);
        let saved = Arc::new(Mutex::new(session()));
        let first = synchronize("concurrent-test",&url,&url,
            || Ok(saved.lock().unwrap().clone()),
            |db| { *saved.lock().unwrap()=db.clone(); Ok(()) });
        let second = synchronize("concurrent-test",&url,&url,
            || Ok(saved.lock().unwrap().clone()),
            |db| { *saved.lock().unwrap()=db.clone(); Ok(()) });
        let (first,second) = tokio::join!(first,second);
        assert_eq!(first.unwrap(),1); assert_eq!(second.unwrap(),1);
        thread.join().unwrap();
        let requests = seen.lock().unwrap();
        assert_eq!(requests.iter().filter(|r| r.starts_with("POST /connect/token")).count(),1);
        assert!(requests[3].to_lowercase().contains(&format!("authorization: bearer {fresh}").to_lowercase()));
        assert_eq!(saved.lock().unwrap().refresh_token.as_deref(),Some("rotated"));
    }

    #[tokio::test]
    async fn failed_rotation_save_stops_before_retry_and_failed_fetch_keeps_saved_old_snapshot() {
        let response = serde_json::json!({"access_token":token("rotated"),"refresh_token":"new-refresh"}).to_string();
        let (url, seen, thread) = server(vec![(401,"{}".into()),(200,response.clone())]);
        let mut db = session(); let mut attempts = 0;
        let err = run(&url,&url,&mut db, |db| {
            attempts+=1; assert_eq!(db.refresh_token.as_deref(),Some("new-refresh"));
            anyhow::bail!("rotation disk failure")
        }).await.err().unwrap();
        thread.join().unwrap(); assert_eq!(attempts,1);
        assert!(err.to_string().contains("rotation disk failure"));
        assert_eq!(seen.lock().unwrap().len(),2);
        let (url, _, thread) = server(vec![(401,"{}".into()),(200,response),(500,"{}".into())]);
        let mut db = session(); let mut committed = None;
        assert!(run(&url,&url,&mut db, |db| { committed=Some(db.clone()); Ok(()) }).await.is_err());
        thread.join().unwrap();
        let committed = committed.unwrap();
        assert_eq!(committed.refresh_token.as_deref(),Some("new-refresh"));
        assert_eq!(committed.snapshot.unwrap().ciphers[0].id,"old-item");
    }

    #[tokio::test]
    async fn logout_during_fetch_cannot_recreate_a_forgotten_session() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let ready = Arc::new(AtomicBool::new(false));
        let release = Arc::new(AtomicBool::new(false));
        let (ready_server,release_server) = (ready.clone(),release.clone());
        let (url, _, thread) = server_with_hook(vec![(200,body())], move |_| {
            ready_server.store(true,Ordering::SeqCst);
            let deadline = std::time::Instant::now()+std::time::Duration::from_secs(10);
            while !release_server.load(Ordering::SeqCst) {
                assert!(std::time::Instant::now()<deadline);
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
        });
        let saved = Arc::new(Mutex::new(Some(session())));
        let operation = synchronize("logout-test",&url,&url,
            || Ok(saved.lock().unwrap().as_ref().unwrap().clone()),
            |db| { *saved.lock().unwrap()=Some(db.clone()); Ok(()) });
        let logout = async {
            while !ready.load(Ordering::SeqCst) { tokio::time::sleep(std::time::Duration::from_millis(2)).await; }
            invalidate("logout-test", || { *saved.lock().unwrap()=None; });
            release.store(true,Ordering::SeqCst);
        };
        let (result,_) = tokio::join!(operation,logout);
        thread.join().unwrap();
        assert!(result.err().unwrap().to_string().starts_with("err.sessionEnded"));
        assert!(saved.lock().unwrap().is_none());
    }
}
