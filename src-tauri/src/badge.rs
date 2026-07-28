//! The number on the app icon.
//!
//! Unread mail in the Inbox, and deliberately not the Screener's count beside
//! it. A badge is a claim that something needs you, and the whole argument of
//! the Screener is that mail from someone you have not chosen does not — it
//! waits, in a place you visit when you decide to, and a red number on the
//! dock is the opposite of waiting. The two counts sit side by side in the
//! rail, where neither is shouting.
//!
//! Desktop only, and not by choice. `WebviewWindow::set_badge_count` documents
//! iOS behaviour in its own doc comment and then lives inside a
//! `#[cfg(desktop)]` impl block, so on iOS the method does not exist —
//! something `cargo check` on a Mac cannot tell you, and the iOS build says
//! immediately. Tauri 2.11 exposes no other badge API and the notification
//! plugin carries no badge field, so there is nothing to fall back to. On a
//! phone the unread count lives in the tab bar instead, which is on screen
//! whenever the app is.

use tauri::AppHandle;

/// Sets or clears the badge.
///
/// Zero clears it rather than drawing a nought, which is the convention on
/// every platform that has one.
#[tauri::command]
pub fn set_unread_badge(app: AppHandle, count: u32) {
    #[cfg(desktop)]
    {
        use tauri::Manager;

        if let Some(window) = app.get_webview_window("main") {
            // A badge is decoration for a count that is already on screen. If
            // the platform refuses — Windows has no dock — there is nothing to
            // tell the user and nothing to retry.
            let _ =
                window.set_badge_count(if count == 0 { None } else { Some(count.into()) });
        }

        // The same number, in the one place it stays visible with every window
        // shut. Set here rather than from its own command because it is the
        // same fact, and two commands is two chances for them to disagree.
        crate::tray::set_count(&app, count);
    }

    // The command stays registered on mobile so the one `invoke` in the
    // frontend does not need a platform test around it, but there is nothing
    // for it to do there.
    let _ = (&app, count);
}
