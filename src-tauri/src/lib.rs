mod google;

use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

/// What the setup screen needs to know before it draws anything.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupState {
    /// A Google client has been configured on this machine.
    has_client: bool,
    /// There is a refresh token, so Pigeon can reach mail without consent.
    has_session: bool,
}

#[tauri::command]
fn google_setup_state() -> SetupState {
    SetupState {
        has_client: google::stored_credentials().is_some(),
        has_session: google::has_refresh_token(),
    }
}

/// Accepts the JSON Google's "Download JSON" button produces, pasted as text.
#[tauri::command]
fn google_set_credentials(raw: String) -> Result<(), String> {
    google::store_credentials(&google::parse_credentials(&raw)?)
}

/// The same, for a file dropped onto the window. The contents never cross back
/// into the webview — only the verdict does.
#[tauri::command]
fn google_set_credentials_from_path(path: String) -> Result<(), String> {
    let raw =
        std::fs::read_to_string(&path).map_err(|_| "Pigeon couldn't read that file.".to_string())?;
    google::store_credentials(&google::parse_credentials(&raw)?)
}

/// Opens the native file picker. `false` means the user cancelled.
#[tauri::command]
async fn google_pick_credentials(app: tauri::AppHandle) -> Result<bool, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("Google client JSON", &["json"])
        .set_title("Choose the JSON file Google gave you")
        .pick_file(move |path| {
            let _ = tx.send(path);
        });

    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .map_err(|e| format!("The file picker stopped unexpectedly: {e}"))?;

    let Some(file) = picked else { return Ok(false) };
    let path = file
        .into_path()
        .map_err(|_| "Pigeon couldn't read that file.".to_string())?;
    let raw =
        std::fs::read_to_string(&path).map_err(|_| "Pigeon couldn't read that file.".to_string())?;
    google::store_credentials(&google::parse_credentials(&raw)?)?;
    Ok(true)
}

#[tauri::command]
fn google_forget_credentials() {
    google::forget_credentials();
}

#[tauri::command]
async fn google_sign_in(app: tauri::AppHandle) -> Result<google::Session, String> {
    google::sign_in(&app).await
}

#[tauri::command]
async fn google_refresh() -> Result<google::Session, String> {
    google::refresh().await
}

#[tauri::command]
async fn google_sign_out() {
    google::sign_out().await;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            google_setup_state,
            google_set_credentials,
            google_set_credentials_from_path,
            google_pick_credentials,
            google_forget_credentials,
            google_sign_in,
            google_refresh,
            google_sign_out,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
