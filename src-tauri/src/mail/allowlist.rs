//! Who may interrupt you, in a form a background wake-up can read.
//!
//! §2.3's rule — approved reaches the inbox, unknown waits in the Screener —
//! is decided in TypeScript, against `localStorage` and a cutoff date, and
//! Gmail knows nothing about it: the INBOX on the server holds everyone.
//!
//! That is fine while Pigeon is open, and useless the moment it is not. iOS
//! wakes the app into a *fresh process* with no webview and no `localStorage`,
//! and something has to decide whether the message that just arrived is worth
//! a notification. So the answer is mirrored down here as a flat set of
//! addresses, rewritten whenever the senders change.
//!
//! It is a projection of the rule, not the rule. The full test also involves
//! the screening cutoff and a thread's own start date, which are not worth
//! reimplementing across the boundary — so an address that is not in this set
//! simply gets no notification, and the mail waits in the Screener where it
//! was going anyway. Being wrong in that direction costs a notification.
//! Being wrong in the other costs the entire promise of the product.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const FILE: &str = "notify-allowlist.json";

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No data directory to store the allowlist in: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(FILE))
}

/// Replaces the stored set.
///
/// Addresses are lowercased on the way in so the background check never has to
/// remember to: mail headers are mixed case, and `Dana@` failing to match
/// `dana@` would be a silence nobody could explain.
pub fn store(app: &AppHandle, emails: &[String]) -> Result<(), String> {
    let normalised: Vec<String> = emails
        .iter()
        .map(|e| e.trim().to_lowercase())
        .filter(|e| !e.is_empty())
        .collect();
    let json = serde_json::to_string(&normalised).map_err(|e| e.to_string())?;
    std::fs::write(path(app)?, json).map_err(|e| e.to_string())
}

/// Forgets the set. Called when the account is disconnected, so a background
/// wake-up after a sign-out has nobody it is allowed to announce.
pub fn clear(app: &AppHandle) {
    if let Ok(file) = path(app) {
        let _ = std::fs::remove_file(file);
    }
}
