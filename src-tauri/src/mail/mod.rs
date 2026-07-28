//! Gmail over IMAP and SMTP, with an app password.
//!
//! This replaced a Google Cloud OAuth client and its five-step console setup.
//! An app password needs one Google page and one paste, never expires, and
//! works the same for every clone of this repo — the trade is that it is a
//! full-credential (kept in the Keychain, sent only to Gmail's own servers)
//! and that Google offers them for personal accounts only.
//!
//! Layout: `session` owns the connection and the Keychain; `fetch` reads,
//! `act` writes, `send` speaks SMTP; `parse` turns RFC 2822 into the JSON the
//! webview maps into Pigeon's domain; `watch` holds a second connection open
//! and says when the inbox changed. Commands do no work of their own — each
//! wraps one blocking call so the webview never waits on the wire.

mod act;
mod allowlist;
mod background;
mod fetch;
mod parse;
mod send;
mod session;
mod types;
mod watch;

use std::path::PathBuf;

use tauri::Manager;

use types::{ListPage, SentRecipient, ThreadJson};

/// Where the two halves of the background path meet.
///
/// The foreground writes the allowlist and the UID mark here through Tauri;
/// the iOS wake-up reads them with no Tauri app at all, from the container
/// path Swift hands it. One directory, resolved two ways.
fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("No data directory: {e}"))
}

/// [`background::Arrivals`], on its way to the webview.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArrivalsJson {
    pub count: u32,
    pub names: Vec<String>,
    pub subject: Option<String>,
}

/// Runs blocking IMAP work off the main thread.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("Mail work stopped unexpectedly: {e}"))?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailStatus {
    pub connected: bool,
    pub email: Option<String>,
}

#[tauri::command]
pub fn mail_status() -> MailStatus {
    let creds = session::stored_credentials();
    MailStatus {
        connected: creds.is_some(),
        email: creds.map(|c| c.email),
    }
}

/// Verifies the sign-in end to end before storing anything: a wrong password
/// fails here, in words, not later as a broken inbox.
#[tauri::command]
pub async fn mail_connect(
    app: tauri::AppHandle,
    email: String,
    password: String,
) -> Result<(), String> {
    blocking(move || session::connect(&email, &password)).await?;
    // Only once the credentials are known good. Starting the watcher on the
    // way in would have it retrying a password Gmail just refused.
    watch::start(app);
    Ok(())
}

/// Mirrors §2.3's answer down for the background wake-up on iOS, which runs
/// in a process with no webview to ask.
#[tauri::command]
pub fn mail_set_notify_allowlist(app: tauri::AppHandle, emails: Vec<String>) -> Result<(), String> {
    allowlist::store(&data_dir(&app)?, &emails)
}

/// Runs one wake-up's worth of work, from the foreground.
///
/// The same function iOS calls in the background, reachable while the app is
/// open — which is the only way to watch it work before there is a device to
/// watch it on. It moves the UID mark like any other run, so calling it twice
/// answers twice only if mail arrived in between.
#[tauri::command]
pub async fn mail_check_arrivals(app: tauri::AppHandle) -> Result<Option<ArrivalsJson>, String> {
    let dir = data_dir(&app)?;
    blocking(move || background::check(&dir)).await.map(|found| {
        found.map(|a| ArrivalsJson {
            count: a.count,
            names: a.names,
            subject: a.subject,
        })
    })
}

#[tauri::command]
pub async fn mail_disconnect(app: tauri::AppHandle) {
    watch::stop();
    // Before the credentials go, so a wake-up racing the sign-out has nobody
    // it is allowed to announce.
    if let Ok(dir) = data_dir(&app) {
        allowlist::clear(&dir);
    }
    let _ = blocking(|| {
        session::forget_credentials();
        Ok(())
    })
    .await;
}

/// Starts the inbox watch for an account that was already connected.
///
/// Called from `setup`, where the credentials are in the Keychain from a
/// previous run and nothing has gone through `mail_connect` this launch.
pub fn resume_watch(app: tauri::AppHandle) {
    if session::is_connected() {
        watch::start(app);
    }
}

/// `offset`/`limit` window what the listing *renders*; `ListPage::total` still
/// reports the whole place. A mailbox with 40,000 conversations is listed, not
/// walked — see `ThreadStub`.
#[tauri::command]
pub async fn mail_list_threads(place: String, offset: u32, limit: u32) -> Result<ListPage, String> {
    blocking(move || fetch::list_threads(place, offset, limit)).await
}

#[tauri::command]
pub async fn mail_search(query: String, limit: u32) -> Result<ListPage, String> {
    blocking(move || fetch::search_threads(query, limit)).await
}

#[tauri::command]
pub async fn mail_get_thread(thread_id: String) -> Result<ThreadJson, String> {
    blocking(move || fetch::get_thread(thread_id)).await
}

#[tauri::command]
pub async fn mail_set_place(thread_id: String, place: String) -> Result<(), String> {
    blocking(move || act::set_place(thread_id, place)).await
}

#[tauri::command]
pub async fn mail_mark_read(thread_id: String, read: bool) -> Result<(), String> {
    blocking(move || act::mark_read(thread_id, read)).await
}

#[tauri::command]
pub async fn mail_silence(thread_id: String, silence: bool) -> Result<(), String> {
    blocking(move || act::silence(thread_id, silence)).await
}

#[tauri::command]
pub async fn mail_send(raw: String, to: Vec<String>) -> Result<(), String> {
    blocking(move || send::send_raw(raw, to)).await
}

#[tauri::command]
pub async fn mail_sent_recipients(limit: u32) -> Result<Vec<SentRecipient>, String> {
    blocking(move || send::sent_recipients(limit)).await
}

#[tauri::command]
pub async fn mail_attachment(uid: u32, index: usize) -> Result<String, String> {
    blocking(move || fetch::attachment(uid, index)).await
}
