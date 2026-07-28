//! The number on the app icon.
//!
//! Unread mail in the Inbox, and deliberately not the Screener's count beside
//! it. A badge is a claim that something needs you, and the whole argument of
//! the Screener is that mail from someone you have not chosen does not — it
//! waits, in a place you visit when you decide to, and a red number on the
//! dock is the opposite of waiting. The two counts sit side by side in the
//! rail, where neither is shouting.

use tauri::{AppHandle, Manager};

/// Sets or clears the badge.
///
/// Zero clears it rather than drawing a nought, which is the platform
/// convention on both of the platforms this runs on.
#[tauri::command]
pub fn set_unread_badge(app: AppHandle, count: u32) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // A badge is decoration for a count that is already on screen. If the
    // platform refuses — Windows has no dock, Android has no API — there is
    // nothing to tell the user and nothing to retry.
    let _ = window.set_badge_count(if count == 0 { None } else { Some(count.into()) });

    // The same number, in the one place it stays visible with every window
    // shut. Set here rather than from its own command because it is the same
    // fact, and two commands is two chances for them to disagree.
    #[cfg(desktop)]
    crate::tray::set_count(&app, count);
}
